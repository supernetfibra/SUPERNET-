/**
 * Caso de uso: enviar (ou pré-visualizar) o lembrete de uma fatura.
 *
 * É o que o botão "enviar agora" do painel chama. Três decisões de projeto aqui:
 *
 * 1. **A prévia e o envio são o mesmo código.** Com `dryRun` o módulo renderiza o
 *    texto exato e para; sem ele, enfileira e despacha. O que o humano confirmou na
 *    caixa de diálogo é literalmente o que sai — não uma segunda renderização.
 *
 * 2. **O envio passa pela outbox.** Não existe `sendMessage()` aqui. Enfileirar é
 *    idempotente (`billing:<id>:manual`), então clicar duas vezes no botão não
 *    manda duas mensagens: o segundo clique recebe `already_sent` com a data do
 *    primeiro.
 *
 * 3. **Consentimento é explícito, mas o humano manda.** Sem opt-in registrado o
 *    envio é bloqueado — a menos que a requisição traga `force`, que é o `force`
 *    que a caixa de diálogo mostra. O override é registrado na auditoria, então
 *    existe decisão humana rastreável em vez de bypass silencioso.
 */

import {
  billingValue,
  civilToday,
  classifyBilling,
  isCivilDate,
  maskPhone,
  pickCustomerPhone,
  type Channel,
  type RawBilling,
  type RawCustomer,
} from "./model.ts";
import { buildPayload, renderFor, toStoredPayload, type ChannelTemplate } from "./templates.ts";
import { DEFAULT_RULES, type ReminderRule } from "./rules.ts";
import type { OutboxApi } from "./outbox.ts";
import type { DispatchSummary } from "./dispatch.ts";

export interface BillingContact {
  phoneE164: string | null;
  optIn: boolean;
  customerName?: string | null;
}

export interface SaveContactInput {
  customerId: string;
  cpf: string | null;
  customerName: string | null;
  phoneE164: string;
  source: string;
  optIn: boolean;
}

export interface SendBillingDeps {
  outbox: OutboxApi;
  getContact: (customerId: string) => Promise<BillingContact | null>;
  /**
   * Régua em vigor (a persistida). Sem isso o envio sob demanda resolveria o evento
   * pela régua do código e uma regra renomeada no painel cairia no template errado.
   */
  getRules?: () => Promise<ReminderRule[]>;
  saveContact?: (input: SaveContactInput) => Promise<void>;
  dispatch: (options: { ids: string[]; policy: "manual" | "automated"; limit?: number }) => Promise<DispatchSummary>;
  templates?: ChannelTemplate[];
  now?: () => number;
  portalBaseUrl?: string;
  companyName?: string;
}

export interface SendBillingInput {
  customer: RawCustomer;
  billing: RawBilling;
  /** Regra que originou o aviso. Default: `manual`. */
  ruleKey?: string;
  channel?: Channel;
  /** Prévia apenas: renderiza e não grava nada. */
  dryRun?: boolean;
  /** Envia mesmo sem opt-in registrado (decisão humana explícita). */
  force?: boolean;
}

export type SendBillingStatus = "preview" | "sent" | "queued" | "already_sent" | "failed" | "blocked";

export interface SendBillingResult {
  status: SendBillingStatus;
  reason: string;
  deliveryId: string | null;
  eventId: string | null;
  dedupeKey: string;
  customerId: string;
  phoneMasked: string | null;
  phone: string | null;
  optIn: boolean;
  forced: boolean;
  preview: { title?: string; body: string } | null;
  dispatch: DispatchSummary | null;
}

/** `manual` não está em DEFAULT_RULES: é um aviso sob demanda, fora da régua. */
export function eventKeyForRule(ruleKey: string, rules: ReminderRule[] = DEFAULT_RULES): string {
  const rule = rules.find((item) => item.key === ruleKey);
  if (rule) return rule.eventKey;
  return "billing.due_soon";
}

export function dedupeKeyFor(billingId: string | number, ruleKey: string): string {
  return `billing:${billingId}:${ruleKey}`;
}

export async function sendBillingReminder(
  deps: SendBillingDeps,
  input: SendBillingInput
): Promise<SendBillingResult> {
  const now = deps.now ?? (() => Date.now());
  const channel: Channel = input.channel ?? "whatsapp";
  const ruleKey = input.ruleKey ?? "manual";
  const rules = (await deps.getRules?.().catch(() => null)) ?? DEFAULT_RULES;
  const eventKey = eventKeyForRule(ruleKey, rules);
  const billingId = String(input.billing.id ?? "");
  const customerId = String(input.customer.id ?? input.billing.customer_id ?? "");
  const dedupeKey = dedupeKeyFor(billingId, ruleKey);

  const base: SendBillingResult = {
    status: "blocked",
    reason: "",
    deliveryId: null,
    eventId: null,
    dedupeKey,
    customerId,
    phoneMasked: null,
    phone: null,
    optIn: false,
    forced: false,
    preview: null,
    dispatch: null,
  };

  // Cobrar fatura paga é o pior erro possível deste botão: o valor cobrado
  // contradiz o que o cliente já fez. A guarda fica aqui, no servidor — a UI só
  // esconde o botão, e esconder não é impedir.
  const state = classifyBilling(input.billing.situation_name);
  if (state !== "open") {
    return {
      ...base,
      reason:
        state === "paid"
          ? "esta fatura consta como paga — nenhum lembrete foi enviado"
          : state === "canceled"
            ? "esta fatura está cancelada — nenhum lembrete foi enviado"
            : `situação da fatura não reconhecida (${input.billing.situation_name ?? "vazia"}) — confirme antes de cobrar`,
    };
  }

  const dueDate = input.billing.due_day;
  if (!isCivilDate(dueDate)) {
    return { ...base, reason: "fatura sem data de vencimento válida" };
  }

  const reference = String(input.billing.reference ?? billingId);
  const payload = buildPayload({
    customer: input.customer,
    billing: input.billing,
    dueDate,
    reference,
    referenceDate: civilToday(now()),
    portalBaseUrl: deps.portalBaseUrl ?? "https://minhasupernet.com",
    companyName: deps.companyName ?? "MinhaSuperNet",
  });

  const rendered = renderFor(channel, eventKey, payload, deps.templates);
  if (!rendered.message) {
    return { ...base, reason: `sem template ativo para ${channel}/${eventKey}` };
  }
  const preview = { title: rendered.message.title, body: rendered.message.body };

  // --- destinatário -------------------------------------------------------
  const contact = customerId ? await deps.getContact(customerId) : null;
  const fromCustomer = pickCustomerPhone(input.customer);
  const phone = contact?.phoneE164 ?? (fromCustomer.ok ? fromCustomer.e164 : null);
  const optIn = Boolean(contact?.optIn);

  if (!phone) {
    return {
      ...base,
      preview,
      optIn,
      reason:
        fromCustomer.ok || contact?.phoneE164
          ? "telefone do cliente não é um celular válido"
          : "cliente sem celular cadastrado",
    };
  }

  const phoneMasked = maskPhone(phone);

  if (!optIn && !input.force) {
    return {
      ...base,
      preview,
      phone,
      phoneMasked,
      optIn,
      reason: "cliente sem registro de opt-in para WhatsApp — confirme para enviar mesmo assim",
    };
  }

  if (input.dryRun) {
    // A prévia também consulta a outbox: assim o painel avisa "já registrado"
    // antes do clique, em vez de só depois de tentar enviar.
    const existingEvent = await deps.outbox.findEventByDedupeKey(dedupeKey).catch(() => null);
    const existing = existingEvent
      ? await deps.outbox.findDelivery({ eventId: existingEvent.id, channel, target: phone }).catch(() => null)
      : null;

    if (existing) {
      const when = existing.sentAt ?? existing.createdAt;
      return {
        ...base,
        status: "already_sent",
        eventId: existingEvent?.id ?? null,
        deliveryId: existing.id,
        preview,
        phone,
        phoneMasked,
        optIn,
        reason: `já registrado em ${new Date(when).toISOString().slice(0, 16).replace("T", " ")} (situação: ${existing.status})`,
      };
    }

    return { ...base, status: "preview", preview, phone, phoneMasked, optIn, reason: "prévia — nada foi gravado nem enviado" };
  }

  // --- enfileiramento idempotente ----------------------------------------
  const storedPayload = toStoredPayload(payload, dueDate);
  const enqueued = await deps.outbox.enqueue({
    eventKey,
    dedupeKey,
    customerId: customerId || null,
    cpf: String(input.customer.cpf_cnpj ?? "") || null,
    payload: storedPayload,
    priority: "transactional",
    channel,
    target: phone,
    rendered: preview,
    scheduledFor: now(),
  });

  if (!enqueued.created || !enqueued.deliveryId) {
    const existing = enqueued.eventId
      ? await deps.outbox.findDelivery({ eventId: enqueued.eventId, channel, target: phone })
      : null;
    const when = existing?.sentAt ?? existing?.createdAt ?? null;
    return {
      ...base,
      status: "already_sent",
      eventId: enqueued.eventId,
      deliveryId: existing?.id ?? null,
      preview,
      phone,
      phoneMasked,
      optIn,
      forced: !optIn && Boolean(input.force),
      reason: `aviso já registrado${when ? ` em ${new Date(when).toISOString().slice(0, 16).replace("T", " ")}` : ""} — nada foi reenviado`,
    };
  }

  // Registra o contato para o painel ter o número e a origem do consentimento.
  if (!contact && deps.saveContact) {
    await deps.saveContact({
      customerId,
      cpf: String(input.customer.cpf_cnpj ?? "") || null,
      customerName: String(input.customer.full_name ?? "") || null,
      phoneE164: phone,
      source: optIn ? "portal" : "manual",
      optIn,
    });
  }

  const dispatch = await deps.dispatch({ ids: [enqueued.deliveryId], policy: "manual", limit: 1 });
  const item = dispatch.results.find((entry) => entry.deliveryId === enqueued.deliveryId);

  const status: SendBillingStatus = dispatch.sent > 0 ? "sent" : dispatch.paused || item?.status === "queued" ? "queued" : "failed";
  const reason =
    status === "sent"
      ? "mensagem enviada"
      : status === "queued"
        ? dispatch.pauseReason ?? item?.reason ?? "enfileirada para reenvio"
        : item?.reason ?? "falha no envio";

  return {
    ...base,
    status,
    reason,
    eventId: enqueued.eventId,
    deliveryId: enqueued.deliveryId,
    preview,
    phone,
    phoneMasked,
    optIn,
    forced: !optIn && Boolean(input.force),
    dispatch,
  };
}

/** Valor exibido na confirmação, para o humano não confirmar às cegas. */
export function describeBilling(billing: RawBilling): { reference: string; dueDate: string; value: number; total: number } {
  const value = billingValue(billing);
  return {
    reference: String(billing.reference ?? billing.id ?? ""),
    dueDate: String(billing.due_day ?? ""),
    value: value.base,
    total: value.total,
  };
}
