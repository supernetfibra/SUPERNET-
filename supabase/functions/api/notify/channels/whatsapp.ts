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
 */

import { humanDelayMs, createUazapiClient, UazapiError, type UazapiClient } from "../uazapi.ts";
import type { WhatsAppConfig } from "../config.ts";
import type { OutboxApi } from "../outbox.ts";
import type { ChannelAdapter, ChannelDeliveryResult, ChannelReadiness, DeliveryContext, Rendered } from "../channel.ts";

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
  minDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_READINESS_TTL_MS = 20_000;

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps): ChannelAdapter {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.readinessTtlMs ?? DEFAULT_READINESS_TTL_MS;
  const clientFactory = deps.createClient ?? ((config: WhatsAppConfig) =>
    createUazapiClient({ baseUrl: config.baseUrl, token: config.instanceToken, adminToken: config.adminToken }));

  let cachedReadiness: { at: number; value: ChannelReadiness } | null = null;

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
    const status = await clientFactory(config).instanceStatus();
    if (!status.connected) {
      return { ok: false, reason: `instância do WhatsApp não está conectada (${status.state})`, retryAt: now() + 15 * 60_000 };
    }
    return { ok: true };
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
        const sent = await client.sendText({
          number: target,
          text: rendered.body,
          delay: humanDelayMs(seedFrom(ctx.eventId, ctx.now), deps.minDelayMs, deps.maxDelayMs),
          linkPreview: true,
          trackId: ctx.eventId,
          readChat: false,
        });
        return { ok: true, providerId: sent.providerId };
      } catch (error) {
        if (!(error instanceof UazapiError)) {
          return { ok: false, errorKey: "UNKNOWN", errorMessage: String(error), uncertain: true };
        }

        // status 0 = falha de rede/timeout do nosso lado: resultado incerto.
        if (error.status === 0) {
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

    async onPermanentFailure(target, result) {
      // Número inválido/inexistente: registra no contato para o painel mostrar o
      // problema em vez de tentar de novo para sempre.
      await deps.outbox.updateContactOutcome({
        customerId: null,
        target,
        error: result.errorMessage ?? result.errorKey ?? "falha permanente",
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

/** Semente estável a partir do id do evento, para o delay variar por mensagem. */
function seedFrom(value: string, salt: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100_000) + (salt % 1000);
}
