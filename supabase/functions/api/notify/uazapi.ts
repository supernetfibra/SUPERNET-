/**
 * Cliente da UazAPI (WhatsApp).
 *
 * Sem dependências: só `fetch`, que existe no Deno e no Node. Por isso este arquivo
 * entra no `tsconfig.notify.json` e é typecheckado junto com o núcleo — o que ele
 * NÃO faz é ler `Deno.env`: a configuração entra por parâmetro, vinda do
 * `whatsapp_config`/secrets.
 *
 * Regras de ouro (LEMBRETES-WHATSAPP.md §3):
 *   - `admintoken` só em operações administrativas (criar/listar instância);
 *   - `token` da instância para enviar mensagem, ler status e configurar webhook;
 *   - token nunca é logado nem devolvido ao frontend.
 *
 * Sobre erro: a UazAPI não erra "só com 4xx/5xx". O caso que mais importa é o
 * **time-lock** — o WhatsApp recusa *iniciar novas conversas* por volume/qualidade
 * (error_key `WHATSAPP_REACHOUT_TIMELOCK`, provider_code 463) e devolve `until`.
 * Aqui isso vira `retryAt`, para o dispatcher pausar em vez de insistir.
 */

export interface UazapiOptions {
  baseUrl: string;
  /** Token da instância (operações de mensagem e status). */
  token?: string;
  /** Token administrativo (criar/listar instâncias). */
  adminToken?: string;
  timeoutMs?: number;
}

export type InstanceState = "disconnected" | "connecting" | "connected" | "hibernated" | "unknown";

export interface SendTextInput {
  /** Internacional, só dígitos (ex.: "5511987654321"). */
  number: string;
  text: string;
  /** Atraso em ms antes de enviar (mostra "digitando"). */
  delay?: number;
  linkPreview?: boolean;
  async?: boolean;
  trackId?: string;
  readChat?: boolean;
  /**
   * Botões de ação rápida (máx. 3 — limite do WhatsApp). `copy` vira botão
   * nativo "copiar"; `url` abre o link. Usam `/send/menu` (type `button`).
   */
  actions?: Array<{ label: string; copy?: string; url?: string }>;
}

export interface SendTextResult {
  providerId: string | null;
  status: string | null;
  raw: unknown;
}

export interface InstanceStatus {
  state: InstanceState;
  connected: boolean;
  raw: unknown;
}

export interface MessageLimits {
  newChatAvailable: boolean;
  newChatStatus: string | null;
  newChatUsed: number | null;
  newChatTotal: number | null;
  /** Instante (ms) até quando o WhatsApp bloqueia iniciar novas conversas. */
  timeLockUntil: number | null;
  enforcement: string | null;
}

export class UazapiError extends Error {
  status: number;
  errorKey: string | null;
  providerCode: number | null;
  providerMessage: string | null;
  /** Instante (ms) a partir do qual vale tentar de novo. */
  retryAt: number | null;

  constructor(init: {
    message: string;
    status: number;
    errorKey?: string | null;
    providerCode?: number | null;
    providerMessage?: string | null;
    retryAt?: number | null;
  }) {
    super(init.message);
    this.name = "UazapiError";
    this.status = init.status;
    this.errorKey = init.errorKey ?? null;
    this.providerCode = init.providerCode ?? null;
    this.providerMessage = init.providerMessage ?? null;
    this.retryAt = init.retryAt ?? null;
  }

  /** Bloqueio temporário de novas conversas — o dispatcher deve pausar o canal. */
  get isTimeLock(): boolean {
    return this.errorKey === "WHATSAPP_REACHOUT_TIMELOCK" || this.providerCode === 463;
  }

  /** Credencial inválida: insistir não resolve, precisa de intervenção humana. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Erro de payload: repetir igual não vai funcionar. */
  get isBadRequest(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

/** Resultado de `findMessageByTrackId`: a mensagem foi localizada (ou não) pelo track_id. */
export interface FindMessageResult {
  found: boolean;
  providerId: string | null;
  raw: unknown;
}

export interface UazapiClient {
  sendText(input: SendTextInput): Promise<SendTextResult>;
  /**
   * Conciliação de envios de resultado incerto: procura a mensagem enviada pelo
   * `track_id` que passamos no sendText (`POST /message/find`). Se ela EXISTE, o
   * envio aconteceu apesar do timeout — repetir cego geraria duplicata. Se NÃO
   * existe, o reenvio é seguro. (A UazAPI guarda mensagens enviadas por API
   * pelos últimos 7 dias — janela de sobra para o dispatcher.)
   */
  findMessageByTrackId(trackId: string): Promise<FindMessageResult>;
  instanceStatus(): Promise<InstanceStatus>;
  connect(input?: { phone?: string }): Promise<{ qrCode: string | null; pairCode: string | null; raw: unknown }>;
  messageLimits(): Promise<MessageLimits | null>;
  setWebhook(input: { url: string; events?: string[]; excludeMessages?: string[]; enabled?: boolean }): Promise<void>;
  createInstance(name: string): Promise<{ token: string | null; raw: unknown }>;
}

/**
 * Eventos que o nosso `/webhooks/uazapi` sabe traduzir — e o default do setWebhook.
 * `messages` traz acks de entrega/leitura E respostas de clientes (é por ele que o
 * opt-out "SAIR" chega); `messages_update` traz a evolução de status do envio;
 * `connection` é opcional (mudanças de conexão da instância).
 * `wasSentByApi` é EXCLUÍDO para o canal não enxergar o próprio eco.
 * A página check:notify trava esta lista: painel e servidor precisam concordar.
 */
export const UAZAPI_WEBHOOK_EVENTS = ["messages", "messages_update", "connection"] as const;
export const UAZAPI_WEBHOOK_EXCLUDE = ["wasSentByApi"] as const;

const DEFAULT_TIMEOUT_MS = 20_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Converte "2026-04-07T12:00:00Z" ou epoch em ms. */
function timestampOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Estado normalizado a partir de qualquer formato que a UazAPI devolva. Formatos
 * observados em produção (resposta de `/instance/status`):
 *   `{"status":{"connected":true,"loggedIn":true,…}, "instance":{"status":"connected",…}}`
 * ou `{"status":"connected"}` — o `status` da raiz pode ser OBJETO, e tratá-lo como
 * string devolvia `unknown` para uma instância conectada, bloqueando o canal.
 */
function candidateState(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if ("connected" in record || "loggedIn" in record) {
    if (record.connected === false) return "disconnected";
    return record.connected === true || record.loggedIn === true ? "connected" : "";
  }
  return "";
}

export function parseNormalizedState(raw: unknown): InstanceState {
  const root = asRecord(raw);
  const nested = asRecord(root.instance);
  const value = (
    candidateState(root.status) ||
    candidateState(root.state) ||
    candidateState(nested.status) ||
    candidateState(nested.state) ||
    (typeof raw === "string" ? raw : "")
  ).toLowerCase();
  if (value.includes("connected") && !value.includes("disconnect")) return "connected";
  if (value.includes("connecting") || value.includes("qrcode") || value.includes("pairing")) return "connecting";
  if (value.includes("hibernat") || value.includes("paused")) return "hibernated";
  if (value.includes("disconnect") || value.includes("close")) return "disconnected";
  return "unknown";
}

export function createUazapiClient(options: UazapiOptions): UazapiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    auth: "instance" | "admin" = "instance"
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = auth === "admin" ? options.adminToken : options.token;
    if (token) headers[auth === "admin" ? "admintoken" : "token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      // Timeout é resultado INCERTO num envio: quem chama precisa saber disso.
      throw new UazapiError({ message: `Falha de rede ao chamar a UazAPI: ${message}`, status: 0 });
    }
    clearTimeout(timer);

    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (response.ok) return parsed ?? {};

    const payload = asRecord(parsed);
    const details = asRecord(payload.details);
    const timeLock = asRecord(details.reachout_timelock);
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))
      ? Date.now() + Number(retryAfterHeader) * 1000
      : null;

    throw new UazapiError({
      message:
        stringOrNull(payload.message_ptbr) ??
        stringOrNull(payload.error) ??
        stringOrNull(payload.provider_message_ptbr) ??
        `UazAPI HTTP ${response.status}`,
      status: response.status,
      errorKey: stringOrNull(payload.error_key),
      providerCode: numberOrNull(payload.provider_code),
      providerMessage: stringOrNull(payload.provider_message) ?? stringOrNull(payload.message),
      retryAt: timestampOrNull(timeLock.until) ?? retryAfterMs,
    });
  }

  return {
    async sendText(input) {
      const body: Record<string, unknown> = {
        number: input.number,
        text: input.text,
        linkPreview: input.linkPreview ?? true,
      };
      if (input.delay !== undefined) body.delay = input.delay;
      if (input.async !== undefined) body.async = input.async;
      if (input.trackId) body.track_id = input.trackId;
      if (input.readChat !== undefined) body.readchat = input.readChat;

      // Botões de ação (máx. 3): saem por /send/menu, type `button`, com choices
      // `texto|copy:código` / `texto|url`. Só botões de ação — misturar com botões
      // de resposta quebra a exibição (doc da UazAPI).
      const actionChoices = (input.actions ?? [])
        .slice(0, 3)
        .map((action) =>
          action.copy
            ? `${action.label}|copy:${action.copy}`
            : action.url
              ? `${action.label}|${action.url}`
              : action.label
        )
        .filter((choice) => choice.trim().length > 0);

      if (actionChoices.length > 0) {
        const menuPayload = {
          number: input.number,
          type: "button" as const,
          text: input.text,
          choices: actionChoices,
          ...(input.delay !== undefined ? { delay: input.delay } : {}),
          ...(input.trackId ? { track_id: input.trackId } : {}),
          ...(input.readChat !== undefined ? { readchat: input.readChat } : {}),
        };
        try {
          const parsed = asRecord(await request("POST", "/send/menu", menuPayload));
          return {
            providerId: stringOrNull(parsed.messageid) ?? stringOrNull(parsed.id),
            status: stringOrNull(parsed.status) ?? stringOrNull(asRecord(parsed.response).status),
            raw: parsed,
          };
        } catch (error) {
          // O recurso interativo pode não estar disponível (doc: "pode ser
          // descontinuado a qualquer momento"). Fallback em duas partes:
          //   1. o TEXTO segue limpo (sem códigos), com uma nota dizendo que o
          //      código vem na mensagem seguinte;
          //   2. cada CÓDIGO copiável vira uma mensagem PRÓPRIA, contendo SÓ o
          //      código — assim o "copiar mensagem" do WhatsApp copia exatamente
          //      o valor pronto para colar. Prefixos ("📋 Rótulo:") e quebras de
          //      linha no corpo contaminam o valor colado pelo cliente.
          // Links (`url`) já costumam estar no corpo ({{boleto}}/{{link}}): só
          // entram como linha 🔗 se ainda não aparecerem no texto.
          if (error instanceof UazapiError && (error.isBadRequest || error.status === 500)) {
            const copyActions = (input.actions ?? []).filter(
              (action): action is { label: string; copy: string } => typeof action.copy === "string" && action.copy.length > 0
            );
            const urlExtras = (input.actions ?? [])
              .filter((action) => action.url && !input.text.includes(action.url))
              .map((action) => `🔗 ${action.label}: ${action.url}`);
            const note = copyActions.length
              ? "\n\n⚠️ Os botões não estavam disponíveis — o código vem na mensagem seguinte: copie a mensagem inteira."
              : "";
            const fallbackBody = [input.text + note, ...urlExtras].filter((part) => part.length > 0).join("\n\n");
            const fallback = asRecord(await request("POST", "/send/text", { ...body, text: fallbackBody }));
            // Best-effort: a mensagem principal JÁ SAIU — se um código falhar aqui,
            // marcá-la como falha reenviaria a mensagem inteira (duplicata para o
            // cliente). O problema fica registrado em `raw.followupErrors` e o
            // cliente ainda tem o portal/PDF no texto como alternativa.
            const followupErrors: string[] = [];
            for (const action of copyActions) {
              try {
                await request("POST", "/send/text", { number: input.number, text: action.copy });
              } catch (followupError) {
                followupErrors.push(`${action.label}: ${followupError instanceof Error ? followupError.message : String(followupError)}`);
              }
            }
            return {
              providerId: stringOrNull(fallback.messageid) ?? stringOrNull(fallback.id),
              status: stringOrNull(fallback.status) ?? stringOrNull(asRecord(fallback.response).status),
              raw: { fallback, followups: copyActions.length, ...(followupErrors.length ? { followupErrors } : {}) },
            };
          }
          throw error;
        }
      }

      const parsed = asRecord(await request("POST", "/send/text", body));
      return {
        providerId: stringOrNull(parsed.messageid) ?? stringOrNull(parsed.id),
        status: stringOrNull(parsed.status) ?? stringOrNull(asRecord(parsed.response).status),
        raw: parsed,
      };
    },

    async instanceStatus() {
      const parsed = await request("GET", "/instance/status");
      const state = parseNormalizedState(parsed);
      return { state, connected: state === "connected", raw: parsed };
    },

    async findMessageByTrackId(trackId) {
      const parsed = asRecord(
        await request("POST", "/message/find", { track_id: trackId, limit: 1, offset: 0 })
      );
      // A resposta pode vir como lista direta ou embrulhada (`data`/`messages`).
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.data)
          ? (parsed.data as unknown[])
          : Array.isArray(asRecord(parsed.response).data)
            ? (asRecord(parsed.response).data as unknown[])
            : [];
      const first = asRecord(list[0]);
      const providerId = stringOrNull(first.messageid) ?? stringOrNull(first.id) ?? stringOrNull(first.messageId);
      return { found: list.length > 0, providerId, raw: parsed };
    },

    async connect(input) {
      const parsed = asRecord(await request("POST", "/instance/connect", input?.phone ? { phone: input.phone } : {}));
      const instance = asRecord(parsed.instance);
      return {
        qrCode:
          stringOrNull(parsed.qrcode) ??
          stringOrNull(parsed.qr) ??
          stringOrNull(parsed.base64) ??
          stringOrNull(instance.qrcode),
        pairCode: stringOrNull(parsed.paircode) ?? stringOrNull(parsed.pair_code),
        raw: parsed,
      };
    },

    /** `null` = a instância não expõe limites (404): não é erro, só falta de dado. */
    async messageLimits() {
      try {
        const parsed = asRecord(await request("GET", "/instance/wa_messages_limits"));
        const capping = asRecord(parsed.new_chat_message_capping);
        const timeLock = asRecord(parsed.reachout_timelock);
        return {
          newChatAvailable: capping.available === true,
          newChatStatus: stringOrNull(capping.status),
          newChatUsed: numberOrNull(capping.used_quota),
          newChatTotal: numberOrNull(capping.total_quota),
          timeLockUntil: timeLock.active === true ? timestampOrNull(timeLock.until) : null,
          enforcement: stringOrNull(timeLock.enforcement_type),
        };
      } catch (error) {
        if (error instanceof UazapiError && error.status === 404) return null;
        throw error;
      }
    },

    async setWebhook(input) {
      await request("POST", "/webhook", {
        enabled: input.enabled ?? true,
        url: input.url,
        events: input.events ?? [...UAZAPI_WEBHOOK_EVENTS],
        excludeMessages: input.excludeMessages ?? [...UAZAPI_WEBHOOK_EXCLUDE],
      });
    },

    async createInstance(name) {
      const parsed = asRecord(await request("POST", "/instance/create", { name }, "admin"));
      const instance = asRecord(parsed.instance);
      return { token: stringOrNull(parsed.token) ?? stringOrNull(instance.token), raw: parsed };
    },
  };
}

/**
 * Delay pseudo-humano para o envio, com jitter.
 * A UazAPI mostra "digitando..." durante esse intervalo: uma rajada de mensagens
 * disparadas no mesmo instante é um dos padrões que o WhatsApp penaliza.
 */
export function humanDelayMs(
  seed: number,
  min: number | undefined = 2500,
  max: number | undefined = 9000
): number {
  const minMs = min === undefined || !Number.isFinite(min) || min <= 0 ? 2500 : min;
  const maxMs = max === undefined || !Number.isFinite(max) || max < minMs ? minMs * 2 : max;
  const span = Math.max(0, maxMs - minMs);
  const pseudo = Math.abs(Math.sin(seed * 12.9898) * 43758.5453);
  return Math.round(minMs + (pseudo % 1) * span);
}
