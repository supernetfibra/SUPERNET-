/**
 * admin-alerts-send — dispara o alerta de operação ao admin e guarda a memória do
 * anti-spam em `admin_alerts_state` (migration 009: uma linha, key "default").
 *
 * O disparo é DIRETO pela UazAPI (fora da outbox de propósito): o alerta não pode
 * ser adiado pela janela/cota da régua do cliente, e não deve aparecer na página
 * Mensagens — é operação, não lembrete. Quando o WhatsApp não é possível (sem
 * número salvo, sem credenciais, instância fora), cai para PUSH — porque o alerta
 * de "canal parado" não pode morrer junto com o canal.
 *
 * Idempotência do anti-spam: a "reserva" (`markAlertSent`) é gravada ANTES do
 * envio. Num cron que dispara em paralelo, duas mensagens é ruim; dez é péssimo.
 * Falso positivo do lado seguro.
 */

import type { SupabaseLike } from "./outbox.ts";
import { createUazapiClient, UazapiError } from "./uazapi.ts";
import {
  shouldSendAlert,
  sanitizeAlertsState,
  ALERT_COOLDOWN_MS,
  type AlertKey,
  type AdminAlertsConfig,
} from "./admin-alerts.ts";

const ALERTS_TABLE = "admin_alerts_state";
const ALERTS_KEY = "default";

export interface AlertSendDeps {
  db: () => SupabaseLike;
  /** Credenciais do canal (as mesmas do dispatcher). */
  getWhatsAppConfig: () => Promise<{ baseUrl: string; instanceToken: string; adminToken: string }>;
  /** Fallback push (assinaturas do painel). Opcional: sem ele, só WhatsApp. */
  sendPushToAdmins?: (payload: { title: string; body: string }) => Promise<number>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export interface AlertSendResult {
  /** true = respeitou gatilho/config/cooldown E tentou (ou reservou) o envio. */
  triggered: boolean;
  via: "whatsapp" | "push" | "none";
  /** Motivo quando `triggered: false` — para o log do servidor, não para o admin. */
  skippedReason?: string;
}

async function readState(deps: AlertSendDeps, now: number): Promise<Partial<Record<AlertKey, number>>> {
  try {
    const { data } = await deps.db().from(ALERTS_TABLE).select("state").eq("key", ALERTS_KEY).maybeSingle();
    return sanitizeAlertsState((data as { state?: unknown } | null)?.state, now);
  } catch {
    // Tabela ausente (migration 009 pendente) ou falha de leitura: sem memória,
    // o cooldown vira "sempre pode enviar" — falhar aberto, como na cota.
    return {};
  }
}

/** Reserva ANTES de enviar: crons paralelos não dobram o alerta. */
async function markAlertSent(deps: AlertSendDeps, key: AlertKey, now: number): Promise<void> {
  const current = await readState(deps, now);
  try {
    await deps
      .db()
      .from(ALERTS_TABLE)
      .upsert({ key: ALERTS_KEY, state: { ...current, [key]: now }, updated_at: now }, { onConflict: "key" });
  } catch (error) {
    deps.log?.("falha ao gravar o estado do alerta", { key, error: String(error) });
  }
}

/**
 * Verifica os gatilhos e envia o alerta. Chamado pelos crons e pelas rotas
 * manuais; puro o suficiente para o check travar as regras via admin-alerts.ts.
 */
export async function sendAdminAlert(
  deps: AlertSendDeps,
  input: {
    key: AlertKey;
    config: AdminAlertsConfig;
    title: string;
    message: string;
    /** WhatsApp do admin já normalizado; vazio = não tenta WhatsApp. */
    phone: string;
    now: number;
  }
): Promise<AlertSendResult> {
  const state = await readState(deps, input.now);
  const gate = shouldSendAlert({
    key: input.key,
    enabled:
      input.key === "channel-down" ? input.config.alertChannelDown : input.config.alertDispatchFailures,
    cooldownMs: ALERT_COOLDOWN_MS,
    lastSentAt: state[input.key] ?? null,
    now: input.now,
  });
  if (!gate) return { triggered: false, via: "none", skippedReason: "cooldown ou alerta desligado" };

  // Reserva antes de enviar (ver cabeçalho).
  await markAlertSent(deps, input.key, input.now);

  if (input.phone) {
    try {
      const config = await deps.getWhatsAppConfig();
      if (config.baseUrl && config.instanceToken) {
        const client = createUazapiClient({
          baseUrl: config.baseUrl,
          token: config.instanceToken,
          adminToken: config.adminToken,
        });
        await client.sendText({ number: input.phone, text: input.message });
        deps.log?.("alerta de operação enviado por WhatsApp", { key: input.key });
        return { triggered: true, via: "whatsapp" };
      }
      deps.log?.("alerta: credenciais UazAPI ausentes — caindo para push", { key: input.key });
    } catch (error) {
      // Erro de envio NÃO aborta o fallback: a instância fora é justamente um dos
      // motivos do alerta (UazapiError de conexão/timeout entra aqui também).
      deps.log?.("alerta por WhatsApp falhou — caindo para push", {
        key: input.key,
        error: error instanceof UazapiError ? `${error.status} ${error.message}` : String(error),
      });
    }
  }

  if (deps.sendPushToAdmins) {
    const sent = await deps.sendPushToAdmins({ title: input.title, body: input.message });
    if (sent > 0) return { triggered: true, via: "push" };
  }

  return { triggered: true, via: "none", skippedReason: "sem canal disponível (push não entregou)" };
}
