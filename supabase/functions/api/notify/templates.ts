/**
 * Templates e renderização. Módulo puro (ver `model.ts`).
 *
 * Um template por canal: o push precisa de título curto + deep link, o WhatsApp de
 * texto com link e Pix. Ambos consomem o **mesmo payload semântico**, que é o que
 * evita a duplicação entre canais (`NOTIFICACOES-HUB.md` §2).
 *
 * Sintaxe suportada:
 *   {{chave}}                  → substituição
 *   {{#chave}}…{{/chave}}      → seção condicional (renderiza se a chave for não vazia)
 *
 * A seção condicional existe por um motivo concreto: sem ela, uma fatura sem Pix
 * geraria a linha "Pix copia e cola: " pendurada na mensagem.
 */

import {
  billingValue,
  boletoUrl,
  diffDays,
  findPixRaw,
  formatBR,
  formatBRL,
  type Channel,
  type RawBilling,
  type RawCustomer,
} from "./model.ts";

export interface ChannelTemplate {
  channel: Channel;
  eventKey: string;
  name: string;
  /** Só o push usa título (o SW renderiza `data.title`). */
  title?: string;
  body: string;
  active: boolean;
}

/**
 * `{{link}}` aponta para `/faturas/:id` (rota real do app — ver `src/main.tsx`),
 * que exige login. Por isso o boleto direto (`url_boleto`/`integration_link`) é
 * oferecido quando existir: é o caminho de pagamento que funciona sem sessão.
 */
export const DEFAULT_TEMPLATES: ChannelTemplate[] = [
  {
    channel: "whatsapp",
    eventKey: "billing.due_soon",
    name: "Fatura a vencer (WhatsApp)",
    active: true,
    body: [
      "Olá, {{primeiro_nome}}! 👋",
      "Sua fatura de {{referencia}} vence em {{vencimento}} ({{dias_para_vencer}} dias).",
      "Valor: {{valor}}",
      "{{#boleto}}",
      "Boleto (PDF): {{boleto}}",
      "{{/boleto}}",
      "{{#pix}}",
      "Pix copia e cola:",
      "{{pix}}",
      "{{/pix}}",
      "Ver no portal do cliente: {{link}}",
      "",
      "Se já pagou, desconsidere este aviso.",
      "Para não receber mais avisos, responda PARAR.",
    ].join("\n"),
  },
  {
    channel: "whatsapp",
    eventKey: "billing.due_today",
    name: "Vence hoje (WhatsApp)",
    active: true,
    body: [
      "Olá, {{primeiro_nome}}! Sua fatura de {{referencia}} vence *hoje* ({{vencimento}}).",
      "Valor: {{valor}}",
      "{{#boleto}}",
      "Boleto (PDF): {{boleto}}",
      "{{/boleto}}",
      "{{#pix}}",
      "Pix copia e cola:",
      "{{pix}}",
      "{{/pix}}",
      "Ver no portal do cliente: {{link}}",
      "",
      "Pague hoje para evitar juros e bloqueio.",
      "Para não receber mais avisos, responda PARAR.",
    ].join("\n"),
  },
  {
    channel: "whatsapp",
    eventKey: "billing.late",
    name: "Fatura em atraso (WhatsApp)",
    active: true,
    body: [
      "Olá, {{primeiro_nome}}.",
      "A fatura {{referencia}} segue em aberto desde {{vencimento}} — {{dias_atraso}} dias em atraso.",
      "Valor atualizado: {{valor_atualizado}}",
      "{{#boleto}}",
      "Boleto (PDF): {{boleto}}",
      "{{/boleto}}",
      "{{#pix}}",
      "Pix copia e cola:",
      "{{pix}}",
      "{{/pix}}",
      "Ver no portal do cliente: {{link}}",
      "",
      "Se já pagou, desconsidere — a baixa pode levar até 1 dia útil.",
      "Para não receber mais avisos, responda PARAR.",
    ].join("\n"),
  },
  {
    channel: "whatsapp",
    eventKey: "test",
    name: "Mensagem de teste (WhatsApp)",
    active: true,
    // Passa pelo mesmo caminho da fila (outbox → adapter): testar aqui é testar
    // o envio de verdade, não um fetch avulso que pode dar OK com a fila quebrada.
    body: [
      "✅ Teste do canal de WhatsApp do portal de faturas.",
      "Se esta mensagem chegou, o envio está operante.",
      "Gerada em {{data_hora}}.",
    ].join("\n"),
  },
  {
    channel: "push",
    eventKey: "billing.due_soon",
    name: "Fatura a vencer (Push)",
    active: true,
    title: "Fatura a vencer em {{vencimento}}",
    body: "Sua fatura de {{referencia}} vence em {{vencimento}} ({{valor}}). Toque para ver o boleto e o Pix.",
  },
  {
    channel: "push",
    eventKey: "billing.due_today",
    name: "Vence hoje (Push)",
    active: true,
    title: "Sua fatura vence hoje",
    body: "{{referencia}} — {{valor}} com vencimento em {{vencimento}}. Toque para pagar agora.",
  },
  {
    channel: "push",
    eventKey: "billing.late",
    name: "Fatura em atraso (Push)",
    active: true,
    title: "Fatura em atraso",
    body: "A fatura {{referencia}} está em atraso há {{dias_atraso}} dias ({{valor_atualizado}}). Regularize pelo app.",
  },
];

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export type TemplatePayload = Record<string, string>;

export interface PayloadInput {
  customer: RawCustomer | undefined;
  billing: RawBilling;
  dueDate: string;
  reference: string;
  /**
   * Data a partir da qual "dias de atraso" / "dias para vencer" são contados.
   *
   * ATENÇÃO: em produção isso tem de ser a data do ENVIO, não a data em que a
   * mensagem foi enfileirada. Um aviso de atraso agendado para daqui a 3 dias
   * precisa ser renderizado no dia do envio — senão o número de dias fica errado.
   * (O simulador faz exatamente isso: renderiza com `scheduledFor`.)
   */
  referenceDate: string;
  /** Base pública do portal, sem barra final. */
  portalBaseUrl: string;
  companyName: string;
}

/** Monta o payload semântico comum aos dois canais. */
export function buildPayload(input: PayloadInput): TemplatePayload {
  const { billing, dueDate, referenceDate } = input;
  const value = billingValue(billing);
  const fullName = String(input.customer?.full_name ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] || "cliente";
  const pix = findPixRaw(billing);
  const boleto = boletoUrl(billing);
  const overdue = diffDays(referenceDate, dueDate);
  const billingId = String(billing.id ?? "");

  const payload: TemplatePayload = {
    nome: fullName || "cliente",
    primeiro_nome: firstName,
    referencia: input.reference,
    valor: formatBRL(value.base),
    valor_atualizado: formatBRL(value.total),
    vencimento: formatBR(dueDate),
    link: `${input.portalBaseUrl.replace(/\/+$/, "")}/faturas/${encodeURIComponent(billingId)}`,
    empresa: input.companyName,
  };

  if (overdue > 0) payload.dias_atraso = String(overdue);
  else payload.dias_para_vencer = String(Math.abs(overdue));

  if (value.hasCharges) payload.tem_encargos = "1";
  if (pix) payload.pix = pix;
  if (boleto) payload.boleto = boleto;

  return payload;
}

// ---------------------------------------------------------------------------
// Payload armazenado (metadados que o dispatcher lê)
// ---------------------------------------------------------------------------

/**
 * Metadados do evento. Prefixo `__` porque NÃO são placeholders de template: o
 * dispatcher os lê antes de renderizar e `toTemplatePayload()` os descarta.
 *
 *   `__dueDate` → data de vencimento civil, para `scheduleMismatch()` (não afirmar
 *                 atraso antes da hora, não enviar "vence hoje" depois) e para o
 *                 recálculo de `dias_atraso`/`dias_para_vencer` na data do envio;
 *   `__url`     → destino do toque no push.
 *
 * Ficam declarados aqui porque há dois produtores (`send-billing.ts` no envio sob
 * demanda e `sync.ts` no enfileiramento automático) e um consumidor (`dispatch.ts`).
 * Escrever a chave à mão nos três lugares é como o contrato vira dois contratos.
 */
export const EVENT_DUE_DATE = "__dueDate";
export const EVENT_URL = "__url";

/** Payload do template + os metadados de evento que viajam com ele. */
export function toStoredPayload(payload: TemplatePayload, dueDate: string): Record<string, unknown> {
  return { ...payload, [EVENT_DUE_DATE]: dueDate, [EVENT_URL]: payload.link };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface RenderedMessage {
  channel: Channel;
  eventKey: string;
  title?: string;
  body: string;
  /** Placeholders usados no template que não existem no payload (erro de template). */
  missing: string[];
}

const SECTION_RE = /\{\{#(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}/g;
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Seção é opcional por definição: `{{#pix}}` sem Pix no payload é o caminho normal,
 * não erro de template. Por isso uma seção ausente NÃO entra em `missing` — só
 * placeholders que sobraram no texto que realmente foi renderizado. As linhas
 * internas de uma seção removida nunca são avaliadas.
 */
function expandSections(text: string, payload: TemplatePayload): string {
  // Repete até estabilizar para suportar seção dentro de seção.
  let out = text;
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(SECTION_RE, (_match, key: string, inner: string) => (payload[key] ? inner : ""));
    if (next === out) break;
    out = next;
  }
  return out;
}

function substitute(text: string, payload: TemplatePayload, missing: Set<string>): string {
  return text.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const value = payload[key];
    if (value === undefined) {
      missing.add(key);
      return "";
    }
    return value;
  });
}

/** Colapsa linhas em branco deixadas por seções removidas. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

export function renderTemplate(
  template: ChannelTemplate,
  payload: TemplatePayload
): { title?: string; body: string; missing: string[] } {
  const missing = new Set<string>();
  const withSections = expandSections(template.body, payload);
  const body = tidy(substitute(withSections, payload, missing));
  let title: string | undefined;
  if (template.title) {
    const titleSections = expandSections(template.title, payload);
    title = tidy(substitute(titleSections, payload, missing)).replace(/\n+/g, " ");
  }
  return { title, body, missing: [...missing] };
}

export interface RenderResult {
  message: RenderedMessage | null;
  warnings: string[];
}

/** Renderiza um evento para um canal específico. `null` = não há template ativo. */
export function renderFor(
  channel: Channel,
  eventKey: string,
  payload: TemplatePayload,
  templates: ChannelTemplate[] = DEFAULT_TEMPLATES
): RenderResult {
  const template = templates.find((t) => t.active && t.channel === channel && t.eventKey === eventKey);
  if (!template) {
    return { message: null, warnings: [`sem template ativo: ${channel}/${eventKey}`] };
  }
  const rendered = renderTemplate(template, payload);
  return {
    message: { channel, eventKey, title: rendered.title, body: rendered.body, missing: rendered.missing },
    warnings: rendered.missing.map((key) => `placeholder {{${key}}} não existe em ${channel}/${eventKey}`),
  };
}
