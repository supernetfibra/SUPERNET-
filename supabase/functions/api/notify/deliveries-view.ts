/**
 * deliveries-view — transforma linhas da outbox em uma visão legível para o admin.
 *
 * Objetivo: responder "qual mensagem foi enviada para qual cliente e POR QUÊ" sem
 * migration nova. O porquê já está gravado:
 *   - a régua que originou a mensagem vive na `dedupe_key` do evento
 *     (`billing:<id_da_cobranca>:<chave_da_regra>`, ex.: `billing:1234:late_10`);
 *   - o motivo de agendamento/erro vive em `error_message`
 *     ("fora da janela de envio (10h–16h) — volta sozinho", "cota de novas
 *     conversas esgotada", "número inválido"…);
 *   - o nome do cliente vive em `whatsapp_contacts.customer_name`.
 * Esta camada só traduz esses dados em frases curtas para a página Mensagens.
 */

/** Chaves de régua → rótulo. Espelho de `DEFAULT_RULES` (rules.ts); regras
 * renomeadas pelo admin caem no fallback com a própria chave. */
export const RULE_KEY_LABELS: Record<string, string> = {
  d_minus_3: "3 dias antes do vencimento",
  due_day: "no dia do vencimento",
  late_1: "1 dia de atraso",
  late_5: "5 dias de atraso",
  late_10: "10 dias de atraso",
};

/** Campos da entrega usados para compor o motivo (o resto da linha passa reto). */
export interface DeliveryViewInput {
  id: string;
  eventId: string;
  channel: string;
  customerId: string | null;
  cpf: string | null;
  target: string;
  status: string;
  attempts: number;
  scheduledFor: number;
  createdAt: number;
  sentAt: number | null;
  errorKey: string | null;
  errorMessage: string | null;
}

export interface DeliveryView extends DeliveryViewInput {
  /** Chave da régua que originou a mensagem, ex.: `late_10`; `manual` para testes/envios manuais. */
  ruleKey: string | null;
  /** Rótulo legível da régua (o mesmo da página Régua de lembretes). */
  ruleLabel: string | null;
  /** Nome do cliente (whatsapp_contacts) quando conhecido. */
  customerName: string | null;
  /** Frase curta que responde "por que esta mensagem está neste estado". */
  reasonLabel: string;
}

/**
 * Formatação de hora no fuso do operador. O motivo é montado na Edge Function,
 * que roda em UTC — sem timeZone fixo, "Agendado para 16:30" sairia 3h adiantado
 * (13:30 de Brasília). O pipeline inteiro usa America/Sao_Paulo (janela, sync).
 */
function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(ts);
}

/**
 * Primeira frase do detalhe técnico — o erro da UazAPI vem junto com o rótulo.
 * Corta em ponto seguido de espaço (fim de frase de verdade), ponto e vírgula ou
 * quebra de linha — NUNCA em ponto colado (preserva chaves como `billing.late`).
 */
function firstSentence(detail: string | null | undefined): string | null {
  const text = (detail ?? "").trim();
  if (!text) return null;
  const cut = text.split(/(?:\.\s|;|\n)/)[0].trim();
  return (cut || text).slice(0, 120);
}

/** `billing:1234:late_10` → `late_10`; `manual:test:…` → `manual`; resto → null. */
function extractRuleKey(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey) return null;
  if (dedupeKey.startsWith("manual:")) return "manual";
  const match = /^billing:[^:]+:([a-z0-9_-]+)$/i.exec(dedupeKey);
  return match ? match[1] : null;
}

/**
 * Frase do motivo por status. A `error_message` NÃO é erro quando a entrega está
 * na fila: o dispatcher grava nela o MOTIVO da espera ("fora da janela", cota).
 * Por isso a frase de "queued" usa essa anotação como explicação, não como falha.
 */
export function buildReasonLabel(
  input: Pick<DeliveryViewInput, "status" | "sentAt" | "scheduledFor" | "errorMessage">,
  now: number
): string {
  const detail = firstSentence(input.errorMessage);
  const withDetail = detail ? ` — ${detail}` : "";

  switch (input.status) {
    case "queued":
      if (input.scheduledFor > now) return `Agendado para ${formatDateTime(input.scheduledFor)}${withDetail}`;
      return `Pronto para enviar agora${withDetail}`;
    case "sending":
      return "Enviando agora";
    case "sent":
    case "delivered":
    case "read": {
      const when = input.sentAt ? ` em ${formatDateTime(input.sentAt)}` : "";
      if (input.status === "read") return `Enviado${when} (lido pelo cliente)`;
      if (input.status === "delivered") return `Enviado${when} (entregue no WhatsApp)`;
      return `Enviado${when} pelo lembrete automático`;
    }
    case "failed":
      return `Falhou o envio${withDetail}`;
    case "skipped":
      return `Não foi enviado${withDetail}`;
    case "canceled":
      return "Cancelado pelo admin antes do envio";
    default:
      return detail ? `Status ${input.status}${withDetail}` : `Status ${input.status}`;
  }
}

/**
 * Linha crua → visão para o painel. Campos aditivos: a página Mensagens ignora o
 * que não conhece, e nenhuma fonte do dispatcher é alterada.
 */
export function toDeliveryView(
  input: DeliveryViewInput & { dedupeKey?: string | null },
  opts: { customerName?: string | null; now: number }
): DeliveryView {
  const ruleKey = extractRuleKey(input.dedupeKey ?? null);
  return {
    ...input,
    ruleKey,
    ruleLabel:
      ruleKey === "manual"
        ? "Envio manual/teste"
        : ruleKey
          ? RULE_KEY_LABELS[ruleKey] ?? `Régua: ${ruleKey}`
          : null,
    customerName: opts.customerName ?? null,
    reasonLabel: buildReasonLabel(input, opts.now),
  };
}
