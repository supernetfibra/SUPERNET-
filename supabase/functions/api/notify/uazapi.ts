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

export interface UazapiClient {
  sendText(input: SendTextInput): Promise<SendTextResult>;
  instanceStatus(): Promise<InstanceStatus>;
  connect(input?: { phone?: string }): Promise<{ qrCode: string | null; pairCode: string | null; raw: unknown }>;
  messageLimits(): Promise<MessageLimits | null>;
  setWebhook(input: { url: string; events?: string[]; excludeMessages?: string[]; enabled?: boolean }): Promise<void>;
  createInstance(name: string): Promise<{ token: string | null; raw: unknown }>;
}

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

function parseNormalizedState(raw: unknown): InstanceState {
  const value = String(typeof raw === "string" ? raw : (asRecord(raw).status ?? asRecord(raw).state ?? "")).toLowerCase();
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
        events: input.events ?? ["messages", "messages_update", "connection"],
        excludeMessages: input.excludeMessages ?? ["wasSentByApi"],
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
export function humanDelayMs(seed: number, min = 2500, max = 9000): number {
  const span = Math.max(0, max - min);
  const pseudo = Math.abs(Math.sin(seed * 12.9898) * 43758.5453);
  return Math.round(min + (pseudo % 1) * span);
}
