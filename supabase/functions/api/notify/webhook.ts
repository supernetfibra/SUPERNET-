/**
 * Webhook da UazAPI.
 *
 * Duas responsabilidades, e só duas:
 *   1. traduzir evento de mensagem em status da entrega (`delivered`, `read`, `failed`);
 *   2. capturar opt-out por palavra-chave (PARAR/SAIR/CANCELAR/DESCADASTRAR).
 *
 * Regras da doc da UazAPI que este código respeita:
 *   - responder rápido (o processamento aqui é uma escrita por evento);
 *   - tolerar evento repetido e fora de ordem — a atualização é idempotente por
 *     `provider_id`, então reprocessar não estraga nada;
 *   - `excludeMessages: ["wasSentByApi"]` no webhook evita responder às próprias
 *     mensagens: **sem isso a automação conversa consigo mesma**.

 * Um detalhe que importa: no push o teto de confirmação é `sent`; aqui `delivered`
 * e `read` são reais. Sem este webhook, o painel mostraria "enviado" para sempre.
 */

import type { OutboxApi, DeliveryStatus, SupabaseLike } from "./outbox.ts";

export interface WebhookEvent {
  event: string;
  messageId: string | null;
  fromMe: boolean;
  isGroup: boolean;
  /** Número do chat, só dígitos quando possível. */
  phone: string | null;
  text: string;
  status: string | null;
  /** Resposta a botão interativo (buttonsResponseMessage), quando for o caso. */
  buttonReply: { label: string; raw: string } | null;
  /** ID da mensagem original à qual o cliente respondeu (contextInfo.stanzaId). */
  stanzaId: string | null;
}

/**
 * Extrai a resposta a botão do payload. O formato varia conforme a versão
 * (Baileys normaliza `buttonsResponseMessage.selectedDisplayText` / .selectedRow
 * e o `contextInfo.stanzaId` aponta para a mensagem original) — aqui vale a
 * regra do parser: aceitar os formatos observáveis em vez de assumir um só.
 */
function extractButtonReply(item: Record<string, unknown>, message: Record<string, unknown>): { label: string; raw: string } | null {
  const candidate =
    asRecord(item.buttons_response_message ?? item.buttonReply ?? item.button_reply) ||
    asRecord(message.buttons_response_message) ||
    asRecord(message.buttonReply);
  const raw = String(
    (candidate.selectedDisplayText as string) ??
      (candidate.selected_display_text as string) ??
      (candidate.selectedRow as string) ??
      (candidate.selected_row as string) ??
      ""
  ).trim();
  if (raw) return { label: raw, raw };
  // Fallback: o texto da mensagem de resposta É o rótulo do botão (Baileys entrega
  // o texto puro em messageType Conversation com o display text no texto).
  const text = String(item.text ?? message.text ?? "").trim();
  return text ? { label: text, raw: text } : null;
}

export interface ParsedWebhook {
  events: WebhookEvent[];
  /** Payload não reconhecido (formato inesperado) — vira log, não erro 500. */
  unparsed: boolean;
}

/** Palavras que valem em qualquer posição inicial de uma mensagem curta. */
const STRONG_OPT_OUT_WORDS = ["parar", "sair", "descadastrar", "descadastrar-se", "stop", "remover", "remover-me"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function digitsOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const digits = value.split("@")[0]!.replace(/\D/g, "");
  return digits || null;
}

/**
 * A UazAPI entrega os eventos em formatos ligeiramente diferentes conforme a
 * versão (payload único ou lista, `EventType`/`event`/`type`). Em vez de assumir
 * um formato, normaliza os três — e devolve `unparsed` quando não reconhece nada,
 * para o evento não sumir sem deixar rastro.
 */
export function parseWebhookPayload(body: unknown): ParsedWebhook {
  const root = asRecord(body);
  const rawEvents: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray(root.events)
      ? (root.events as unknown[])
      : Array.isArray(root.data)
        ? (root.data as unknown[])
        : [root];

  const events: WebhookEvent[] = [];
  for (const raw of rawEvents) {
    const item = asRecord(raw);
    const nestedMessage = asRecord(item.message);
    const eventName = String(item.EventType ?? item.event ?? item.type ?? "").toLowerCase();
    const status = item.status ?? nestedMessage.status ?? null;
    const messageType = String(item.messageType ?? nestedMessage.messageType ?? nestedMessage.message_type ?? "").toLowerCase();
    const isButtonReply = messageType.includes("button") || Boolean(asRecord(nestedMessage.buttons_response_message).selectedDisplayText);

    const messageId =
      item.messageid ?? item.messageId ?? nestedMessage.id ?? nestedMessage.messageid ?? item.id ?? null;
    const contextInfo = asRecord(nestedMessage.contextInfo ?? nestedMessage.context_info ?? item.contextInfo);
    const stanzaId = contextInfo.stanzaId ?? contextInfo.stanza_id ?? null;

    events.push({
      event: eventName,
      messageId: messageId === null ? null : String(messageId),
      fromMe: item.fromMe === true || nestedMessage.fromMe === true,
      isGroup: Boolean(item.isGroup) || String(item.chatid ?? item.chat ?? "").includes("@g.us"),
      // O telefone pode vir na raiz OU dentro de `message` (formato da doc:
      // message.chatid). Sem o fallback aninhado, opt-out e cliques ficam sem
      // telefone e o matching com a entrega falha em silêncio.
      phone:
        digitsOrNull(item.chatid) ??
        digitsOrNull(item.chat) ??
        digitsOrNull(item.sender) ??
        digitsOrNull(item.sender_pn) ??
        digitsOrNull(nestedMessage.chatid) ??
        digitsOrNull(nestedMessage.sender) ??
        digitsOrNull(nestedMessage.sender_pn),
      text: String(item.text ?? nestedMessage.text ?? nestedMessage.conversation ?? "").trim(),
      status: status === null ? null : String(status),
      buttonReply: isButtonReply ? extractButtonReply(item, nestedMessage) : null,
      stanzaId: stanzaId === null || stanzaId === undefined ? null : String(stanzaId),
    });
  }

  // "Tem evento" não é o mesmo que "entendi o evento". Um corpo que virou `[{}]`
  // precisa contar como não reconhecido, senão o log fica silencioso sobre
  // webhooks que a gente não está entendendo.
  const meaningful = events.some(
    (event) => event.event || event.messageId || event.status || event.text || event.phone
  );
  return { events, unparsed: !meaningful };
}

/** Status da UazAPI → status da outbox. Só `Sent`/`Delivered`/`Read` têm equivalente. */
export function mapStatus(raw: string | null): DeliveryStatus | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value.includes("read") || value.includes("played")) return "read";
  if (value.includes("deliver")) return "delivered";
  if (value.includes("sent") || value === "queued") return "sent";
  if (value.includes("fail") || value.includes("error") || value.includes("cancel")) return "failed";
  return null;
}

export function isOptOut(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .trim();
  if (!normalized) return false;

  const words = normalized.split(/\s+/).filter(Boolean);

  // "cancelar" só como primeira palavra: "cancelar" é comando, mas "quero
  // cancelar minha fatura" é outro assunto e não vira opt-out por engano.
  if (words[0] === "cancelar") return true;

  // "parar"/"sair"/"descadastrar" valem nas duas primeiras palavras de uma
  // mensagem curta — pega "quero sair" sem pegar "não vou parar de pagar".
  return words.length <= 3 && words.slice(0, 2).some((word) => STRONG_OPT_OUT_WORDS.includes(word));
}

export interface WebhookDeps {
  db: () => SupabaseLike;
  outbox: OutboxApi;
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export interface WebhookSummary {
  received: number;
  statusUpdated: number;
  optOuts: number;
  ignored: number;
  buttonClicks: number;
}

export async function handleUazapiWebhook(deps: WebhookDeps, body: unknown): Promise<WebhookSummary> {
  const now = deps.now ?? (() => Date.now());
  const parsed = parseWebhookPayload(body);
  const summary: WebhookSummary = { received: parsed.events.length, statusUpdated: 0, optOuts: 0, ignored: 0, buttonClicks: 0 };

  if (parsed.unparsed) {
    deps.log?.("webhook da UazAPI sem eventos reconhecíveis", { keys: Object.keys(asRecord(body)).slice(0, 12) });
    return summary;
  }

  for (const event of parsed.events) {
    // Resposta a botão interativo: registra o clique e casa com a entrega pelo
    // provider_id (contextInfo.stanzaId). Um clique não é mensagem de texto — não
    // deve cair no opt-out nem no "ignorado".
    if (event.buttonReply && !event.fromMe) {
      try {
        let deliveryId: string | null = null;
        if (event.stanzaId) {
          const match = await deps.db()
            .from("notification_deliveries")
            .select("id")
            .eq("provider_id", event.stanzaId)
            .limit(1);
          deliveryId = match.data?.[0]?.id != null ? String(match.data[0].id) : null;
        }
        if (!deliveryId && event.phone) {
          // Sem stanzaId, casa pela conversa: última entrega enviada para este
          // telefone cuja mensagem incluiu o rótulo do botão tocado.
          const fallback = await deps.db()
            .from("notification_deliveries")
            .select("id, actions")
            .eq("target", event.phone)
            .eq("status", "sent")
            .contains("actions", [{ label: event.buttonReply.raw }])
            .order("sent_at", { ascending: false })
            .limit(1);
          deliveryId = fallback.data?.[0]?.id != null ? String(fallback.data[0].id) : null;
        }
        const inserted = await deps.db().from("whatsapp_button_clicks").insert({
          created_at: now(),
          phone_e164: event.phone,
          button_label: event.buttonReply.raw.slice(0, 120),
          selected_row: event.buttonReply.label === event.buttonReply.raw ? null : event.buttonReply.label,
          message_id: event.messageId,
          provider_id: event.stanzaId,
          delivery_id: deliveryId,
        });
        const insertError = inserted.error as { code?: string; message?: string } | null;
        // Reentrega do mesmo evento (message_id único): o clique já foi contabilizado.
        if (insertError && (insertError.code === "23505" || String(insertError.message ?? "").includes("duplicate key"))) {
          summary.ignored++;
          continue;
        }
        if (insertError) throw new Error(insertError.message ?? String(insertError));
        summary.buttonClicks++;
        deps.log?.("clique em botão registrado", { phone: event.phone ? `${event.phone.slice(0, 4)}…` : null, label: event.buttonReply.raw, matched: deliveryId !== null });
      } catch (error) {
        deps.log?.("falha ao registrar clique de botão", { error: String(error) });
      }
      continue;
    }

    // Ao vivo: a mensagem saiu de um número e chegou com pedido de descadastro.
    if (!event.fromMe && !event.isGroup && event.phone && isOptOut(event.text)) {
      try {
        await deps.db()
          .from("whatsapp_contacts")
          .update({ opt_out_at: now(), opt_in: false, updated_at: now() })
          .eq("phone_e164", event.phone);
        summary.optOuts++;
        deps.log?.("opt-out recebido por WhatsApp", { phone: `${event.phone.slice(0, 4)}…` });
      } catch (error) {
        deps.log?.("falha ao registrar opt-out", { error: String(error) });
      }
      continue;
    }

    // Confirmação de entrega/leitura/cobrança.
    const status = mapStatus(event.status);
    if (status && event.messageId) {
      try {
        const updated = await deps.outbox.markStatusByProviderId({
          providerId: event.messageId,
          status,
          event: status === "failed" ? "falha reportada pelo WhatsApp" : undefined,
        });
        if (updated > 0) summary.statusUpdated += updated;
        else summary.ignored++;
      } catch (error) {
        deps.log?.("falha ao atualizar status da entrega", { error: String(error) });
      }
      continue;
    }

    summary.ignored++;
  }

  return summary;
}
