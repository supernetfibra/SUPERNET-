/**
 * Adapter de WhatsApp (UazAPI) para o hub.
 *
 * Casca fina sobre `uazapi.ts`: traduz a configuração em cliente, aplica o delay
 * humano, correlaciona a mensagem com o evento (`track_id`) e converte o erro da
 * UazAPI no vocabulário de desfecho do hub.
 *
 * Três comportamentos que valem dinheiro:
 *   - time-lock (erro 463 / `WHATSAPP_REACHOUT_TIMELOCK`) → `retryAt` **e** pausa
 *     GLOBAL do canal. Insistir durante um bloqueio de novas conversas é o caminho
 *     mais curto para o número ser restringido de vez;
 *   - 401/403 → `permanent`: token inválido não melhora com retry, precisa de gente;
 *   - timeout → `uncertain`, e o dispatcher NÃO repete: o envio pode ter saído.
 *     O envio usa `async: true`, então a pausa humana roda na fila da UazAPI e
 *     timeout de resposta virou evento raro (só queda real de rede).
 */

import { humanDelayMs, createUazapiClient, UazapiError, type UazapiClient } from "../uazapi.ts";
import type { WhatsAppConfig } from "../config.ts";
import type { OutboxApi } from "../outbox.ts";
import type { ChannelAdapter, ChannelDeliveryResult, ChannelReadiness, DeliveryContext } from "../channel.ts";

export interface WhatsAppAdapterDeps {
  /** Lê a config a cada uso — o toggle do admin precisa valer na hora. */
  getConfig: () => Promise<WhatsAppConfig>;
  /** Injetável para teste. */
  createClient?: (config: WhatsAppConfig) => UazapiClient;
  outbox: OutboxApi;
  /** Grava `paused_until` na config quando o provedor manda parar. */
  setPausedUntil?: (until: number) => Promise<void>;
  now?: () => number;
  /** Validade do cache de `ready()`, para não consultar status a cada mensagem. */
  readinessTtlMs?: number;
  /** Intervalo mínimo ENTRE tentativas de reconexão automática (default 10 min). */
  reconnectCooldownMs?: number;
  /** Espera entre `connect()` e a re-checagem de status (default 2.5s; 0 pula — testes). */
  reconnectSettleMs?: number;
  /** Persiste o estado da instância (`whatsapp_config.last_status`) para o painel. */
  setStatus?: (status: string) => Promise<void>;
  /** Ritmo configurável: pausa mínima entre mensagens (ms). Async: lê a config na hora do envio. Número: fixo (testes). */
  minDelayMs?: number | (() => Promise<number | undefined> | number | undefined);
  /** Pausa máxima (ms) — o sorteio entre min e máx é o jitter humano. */
  maxDelayMs?: number | (() => Promise<number | undefined> | number | undefined);
}

const DEFAULT_READINESS_TTL_MS = 20_000;

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps): ChannelAdapter {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.readinessTtlMs ?? DEFAULT_READINESS_TTL_MS;
  const clientFactory = deps.createClient ?? ((config: WhatsAppConfig) =>
    createUazapiClient({ baseUrl: config.baseUrl, token: config.instanceToken, adminToken: config.adminToken }));

  let cachedReadiness: { at: number; value: ChannelReadiness } | null = null;
  let lastReconnectAt = 0;
  const RECONNECT_COOLDOWN_MS = 10 * 60_000;
  const RECONNECT_SETTLE_MS = 2_500;

  async function readReadiness(): Promise<ChannelReadiness> {
    const config = await deps.getConfig();
    if (!config.enabled) {
      return { ok: false, reason: config.origin === "none"
        ? "WhatsApp sem credenciais configuradas"
        : "canal WhatsApp desligado na configuração" };
    }
    if (config.pausedUntil && config.pausedUntil > now()) {
      return { ok: false, reason: "canal em pausa por restrição do WhatsApp", retryAt: config.pausedUntil };
    }
    const client = clientFactory(config);
    let status = await client.instanceStatus();
    await recordStatus(config, status.state);

    // AUTO-RECONECTAR: queda de sessão do WhatsApp é rotina (celular desligado,
    // instância hibernada). Uma tentativa de `connect` por janela — NÃO um laço:
    // se a sessão não volta sozinha, é QRCode na mão de gente, e o alerta de
    // instância caída já avisa o admin.
    if (!status.connected && now() - lastReconnectAt > (deps.reconnectCooldownMs ?? RECONNECT_COOLDOWN_MS)) {
      lastReconnectAt = now();
      try {
        await client.connect();
      } catch {
        // QR/pairing indisponível não muda o veredito — o status de baixo decide.
      }
      const settle = deps.reconnectSettleMs ?? RECONNECT_SETTLE_MS;
      if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle));
      try {
        status = await client.instanceStatus();
        await recordStatus(config, status.state);
      } catch {
        // mantém o primeiro veredito
      }
    }

    if (!status.connected) {
      return { ok: false, reason: `instância do WhatsApp não está conectada (${status.state})`, retryAt: now() + 15 * 60_000 };
    }
    return { ok: true };
  }

  /** Espelha o estado na config (painel mostra o momento real). Best-effort. */
  async function recordStatus(config: WhatsAppConfig, state: string): Promise<void> {
    if (config.lastStatus === state) return;
    try {
      await deps.setStatus?.(state);
    } catch {
      // persistir estado é cosmético — nunca bloqueia o canal
    }
  }

  return {
    key: "whatsapp",

    async ready() {
      if (cachedReadiness && now() - cachedReadiness.at < ttl) return cachedReadiness.value;
      let value: ChannelReadiness;
      try {
        value = await readReadiness();
      } catch (error) {
        value = {
          ok: false,
          reason: error instanceof UazapiError ? `UazAPI ${error.status}: ${error.message}` : `erro ao consultar a instância: ${String(error)}`,
          retryAt: now() + 5 * 60_000,
        };
      }
      cachedReadiness = { at: now(), value };
      return value;
    },

    async deliver(target, rendered, ctx: DeliveryContext): Promise<ChannelDeliveryResult> {
      const config = await deps.getConfig();
      const client = clientFactory(config);

      // Otimista: o alvo já foi normalizado no enfileiramento, mas um alvo
      // malformado é falha permanente, não vale retry.
      if (!/^\d{12,13}$/.test(target)) {
        return {
          ok: false,
          permanent: true,
          errorKey: "INVALID_TARGET",
          errorMessage: `Destino não está em formato E.164 de celular: ${target.slice(0, 4)}…`,
        };
      }

      try {
        const minDelay = typeof deps.minDelayMs === "function" ? await deps.minDelayMs() : deps.minDelayMs;
        const maxDelay = typeof deps.maxDelayMs === "function" ? await deps.maxDelayMs() : deps.maxDelayMs;
        // `async: true`: a pausa humana ("digitando...") fica na FILA da UazAPI
        // e a resposta volta imediata. Sem isso, um delay de 30–60s estourava o
        // timeout do nosso fetch (20s) → abort → "resultado incerto" para uma
        // mensagem que SAIRIA mesmo assim (reproduzido em 30/09/2026). Se a fila
        // falhar depois, o webhook `messages_update` marca `failed` e corrige.
        const sent = await client.sendText({
          number: target,
          text: rendered.body,
          async: true,
          delay: humanDelayMs(seedFrom(ctx.eventId, ctx.now), minDelay, maxDelay),
          linkPreview: true,
          trackId: ctx.eventId,
          readChat: false,
          // Botões de ação rápida (copiar Pix, código de barras, abrir PDF). O
          // cliente UazAPI envia por /send/menu e degrada para texto se o recurso
          // interativo recusar.
          actions: rendered.actions,
        });
        return { ok: true, providerId: sent.providerId };
      } catch (error) {
        if (!(error instanceof UazapiError)) {
          return { ok: false, errorKey: "UNKNOWN", errorMessage: String(error), uncertain: true };
        }

        // status 0 = falha de rede/timeout do nosso lado. Antes de declarar
        // "resultado incerto" (que trava a entrega esperando humano), pergunta à
        // UazAPI se a mensagem saiu: o envio é `async: true` e a resposta pode ter
        // sido abortada DEPOIS de a UazAPI já ter aceito/enfileirado a mensagem
        // (confirmado em produção 05–08/10/2026 — 39 lembretes saíram "invisíveis").
        //   achou por track_id → OK (mesma garantia de um 200);
        //   não achou        → o reenvio é SEGURO, vira erro transitório com retry.
        if (error.status === 0) {
          if (ctx.eventId) {
            // O sendText sai com `delay` humano (sendGapSeconds, async): a UazAPI
            // SÓ registra a mensagem no histórico DEPOIS do envio real. Sondar
            // antes disso devolve "não encontrada" para uma mensagem que ESTÁ
            // enfileirada — reenviar nessa janela DUPLICA (reproduzido em
            // 09/10/2026). Espera o delay passar (+buffer) antes de perguntar.
            const min = typeof deps.minDelayMs === "function" ? await deps.minDelayMs() : deps.minDelayMs;
            const max = typeof deps.maxDelayMs === "function" ? await deps.maxDelayMs() : deps.maxDelayMs;
            const settleMs = Math.max(Number(min) || 0, Number(max) || 0) + 15_000;
            try {
              if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
              const probe = await client.findMessageByTrackId(ctx.eventId);
              if (probe.found) {
                return { ok: true, providerId: probe.providerId };
              }
              // NÃO achou mesmo depois do settling: pode ser a UazAPI demorando
              // a indexar. Reenvio automático aqui já provou que duplica — o
              // conservador é INCERTEZA (conciliação por cron/humano depois).
              return {
                ok: false,
                uncertain: true,
                errorKey: "NETWORK_UNCERTAIN",
                errorMessage: `${error.message} — sonda pós-delay não encontrou a mensagem; aguardando conciliação por track_id, NÃO reenviado`,
              };
            } catch {
              // A sonda também falhou: mantém o comportamento conservador.
            }
          }
          return {
            ok: false,
            errorKey: "NETWORK_UNCERTAIN",
            errorMessage: `${error.message} — resultado incerto, verificar no WhatsApp antes de reenviar`,
            uncertain: true,
          };
        }
        if (error.isTimeLock) {
          const until = error.retryAt ?? now() + 24 * 60 * 60_000;
          return { ok: false, errorKey: error.errorKey ?? "WHATSAPP_REACHOUT_TIMELOCK", errorMessage: error.message, retryAt: until };
        }
        if (error.isAuthError) {
          return { ok: false, errorKey: error.errorKey ?? `HTTP_${error.status}`, errorMessage: error.message, permanent: true };
        }
        if (error.isBadRequest) {
          return { ok: false, errorKey: error.errorKey ?? `HTTP_${error.status}`, errorMessage: error.message, permanent: true };
        }
        // 429 e 5xx: transitório. Respeita `Retry-After` quando veio.
        return {
          ok: false,
          errorKey: error.errorKey ?? `HTTP_${error.status}`,
          errorMessage: error.message,
          retryAt: error.retryAt ?? now() + 10 * 60_000,
        };
      }
    },

    async reconcile(trackId) {
      if (!trackId) return { outcome: "uncertain", reason: "sem track_id para consultar" };
      try {
        const config = await deps.getConfig();
        const probe = await clientFactory(config).findMessageByTrackId(trackId);
        if (probe.found) return { outcome: "sent", providerId: probe.providerId };
        return { outcome: "not_sent" };
      } catch (error) {
        return {
          outcome: "uncertain",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async onPermanentFailure(target, result) {
      // Número inválido/inexistente: registra no contato para o painel mostrar o
      // problema em vez de tentar de novo para sempre. Quando o erro PROVA que o
      // destino está morto, o contato vira tombstone (`status: invalid`) — o sync
      // e o simulador deixam de planejar envios para ele.
      await deps.outbox.updateContactOutcome({
        customerId: null,
        target,
        error: result.errorMessage ?? result.errorKey ?? "falha permanente",
        invalidate: isDeadTargetError(result),
      });
    },

    async onGlobalPause(until) {
      // Persiste a pausa na config: o próximo dispatch — possivelmente em outro
      // processo, horas depois — já começa sabendo que o canal está bloqueado.
      await deps.setPausedUntil?.(until);
      cachedReadiness = null;
    },
  };
}

/**
 * O erro PROVA que o destino é morto? Só quando há certeza — `INVALID_TARGET` é
 * nosso (regex E.164) e a recusa do provedor costuma citar o número. Erro de
 * autenticação (401) é problema da INSTÂNCIA, não do destino: tombstonar todos
 * os contatos por causa de token expirado seria apagar a base de opt-ins.
 */
const DEAD_TARGET_RE = /(n[ãa]o est[ãa] no whatsapp|nao esta no whatsapp|not on whatsapp|invalid (number|phone|wa_id)|n[úu]mero inv[áa]lido|number.*(not|n[ãa]o).*(whatsapp|exist))/i;

function isDeadTargetError(result: { errorKey?: string | null; errorMessage?: string | null }): boolean {
  if (result.errorKey === "INVALID_TARGET") return true;
  return DEAD_TARGET_RE.test(String(result.errorMessage ?? ""));
}

/** Semente estável a partir do id do evento, para o delay variar por mensagem. */
function seedFrom(value: string, salt: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100_000) + (salt % 1000);
}
