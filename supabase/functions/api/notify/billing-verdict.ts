/**
 * Veredito da revalidação da fatura — módulo PURO (ver `model.ts`).
 *
 * A revalidação é a última barreira antes do envio: entre o agendamento e a saída
 * da mensagem o cliente pode ter pago, e cobrar quem já pagou foi o incidente de
 * 09/10/2026. Essa barreira vivia DENTRO do `index.ts` (Deno, com `fetch` e acesso
 * ao banco), então só era exercitada por mock — e mock não pega regressão de regra
 * de negócio. Aqui ficam as três decisões que importam, sem uma linha de I/O:
 *
 *   1. **Onde está a fatura na resposta da MikWeb** (`extractBillingList`/`findBilling`)
 *      — a API responde com envelope (`{billings: [...]}`, às vezes aninhado) ou
 *      array direto, e o `Array.isArray(data) ? data : []` que morava no `index.ts`
 *      transformava envelope inesperado em lista VAZIA: a fatura "não era
 *      encontrada" e o veredito era `open` sempre, sem erro e sem log. É a falha
 *      silenciosa clássica desse tipo de código;
 *   2. **Qual o veredito** (`decideBillingVerdict`);
 *   3. **Qual janela é consultada** (`billingLookupPath`).
 *
 * O chamador (`index.ts`) fica só com o transporte: escolher a conexão, fazer o GET
 * e traduzir exceção em `unknown`.
 */

import { addDays, classifyBilling, hasPaymentEvidence, isCivilDate, toMikwebDate } from "./model.ts";
import { OBSERVATION_EVENT_KEY } from "./rules.ts";

/**
 * Veredito devolvido ao dispatcher.
 *   "open"        → segue para o envio;
 *   "paid"        → quitada (ou cancelada) depois do agendamento: cancela;
 *   "observation" → "Em Observação" (acordo pedido pelo cliente): cancela a COBRANÇA
 *                   com motivo. A mensagem dedicada (`billing.observation`) chega
 *                   como "open", não como isto;
 *   "unknown"     → a fonte não respondeu: ADIA, sem gastar tentativa.
 */
export type BillingVerdict =
  | { status: "open"; situation?: string | null }
  | { status: "paid"; situation?: string | null }
  | { status: "observation"; situation?: string | null }
  | { status: "unknown"; error: string };

/** Fatia da fatura que o veredito lê. O resto da resposta da MikWeb é irrelevante. */
export interface BillingSituationView {
  id?: number | string | null;
  situation_name?: string | null;
  date_payment?: string | null;
  value_paid?: number | string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chaves de envelope já vistas na MikWeb (e os nomes óbvios que ela pode passar a usar). */
const LIST_KEYS = ["billings", "billings_list", "data", "items", "results", "records"] as const;

/**
 * Extrai a lista de faturas do que a fonte devolveu, tolerando o envelope.
 *
 * Aceita array direto, o envelope de um nível (`{billings: [...]}`) e o aninhado
 * (`{data: {billings: [...]}}`). Ignora itens que não são objetos. Devolve `[]`
 * quando não reconhece o formato — o chamador NÃO deve tratar isso como "em
 * aberto" sem pensar, mas o veredito atual trata (`open`), porque uma consulta que
 * não trouxe nada não pode virar laço de adiamento (decisão documentada no
 * `index.ts`/dispatcher: as guardas de data cobrem o resto).
 *
 * A profundidade é limitada para nunca girar em estrutura auto-referente.
 */
export function extractBillingList(response: unknown, depth = 0): BillingSituationView[] {
  if (Array.isArray(response)) return response.filter(isRecord) as BillingSituationView[];
  if (depth >= 3 || !isRecord(response)) return [];
  for (const key of LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value.filter(isRecord) as BillingSituationView[];
    if (isRecord(value)) {
      const nested = extractBillingList(value, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

/**
 * Acha a fatura pelo id dentro da resposta. Comparação por STRING porque o ERP
 * alterna entre número (`id: 900`) e texto (`id: "900"`) conforme o endpoint — o
 * `=== input.invoiceId` original perdia a fatura no primeiro caso.
 */
export function findBilling(response: unknown, invoiceId: string): BillingSituationView | null {
  if (!invoiceId) return null;
  const list = extractBillingList(response);
  return list.find((billing) => String(billing?.id ?? "") === invoiceId) ?? null;
}

/**
 * Decide o veredito a partir da fatura da fonte e do evento que está sendo enviado.
 *
 * Ordem das regras (importa — foi o bug do incidente):
 *   - fatura NÃO encontrada → `open` (não bloqueia; ver `extractBillingList`);
 *   - EVIDÊNCIA DE PAGAMENTO (`date_payment` OU `value_paid > 0`) → `paid`, ANTES de
 *     olhar o rótulo da situação: um ERP que grava o valor pago e só depois a data
 *     (ou nunca) não pode escapar daqui;
 *   - situação paga/cancelada reconhecida → `paid`;
 *   - "Em Observação" → `observation`, exceto para a mensagem DEDICADA
 *     (`billing.observation`), na qual a observação é a situação esperada;
 *   - qualquer outra situação, inclusive desconhecida → `open`: não entendemos o
 *     rótulo, então não inventamos bloqueio (uma situação nova do ERP não pode
 *     parar o canal).
 */
export function decideBillingVerdict(input: {
  billing: BillingSituationView | null | undefined;
  eventKey: string;
}): BillingVerdict {
  const billing = input.billing;
  if (!billing) return { status: "open" };
  const situation = billing.situation_name ?? null;

  if (hasPaymentEvidence(billing)) return { status: "paid", situation };
  const state = classifyBilling(billing.situation_name);
  if (state === "paid" || state === "canceled") return { status: "paid", situation };
  if (state === "observation" && input.eventKey !== OBSERVATION_EVENT_KEY) {
    return { status: "observation", situation };
  }
  return { status: "open", situation };
}

/**
 * Caminho da consulta que a revalidação faz na MikWeb.
 *
 * A janela é `[vencimento - 60d, vencimento + 1d]` com `type_date=due_day` — o
 * MESMO filtro da varredura do sync: fatura paga continua listada dentro da janela
 * do vencimento dela, então consultar por `date_payment` ou por "hoje" perderia a
 * fatura que o lembrete vencido está perseguindo. `ref` é o vencimento do evento
 * quando ele é uma data civil válida; sem vencimento confiável, cai no dia de hoje
 * do chamador (injetado para o módulo continuar puro).
 *
 * Formato das datas: `dd-MM-yyyy` — é o que a MikWeb aceita (ISO é ignorado em
 * silêncio, ver `toMikwebDate`).
 */
export function billingLookupPath(input: {
  /** id CRU do cliente na conta (sem prefixo de slug). */
  customerId: string;
  dueDate: string | null | undefined;
  /** Data civil `YYYY-MM-DD` de referência quando não há vencimento utilizável. */
  today: string;
}): string {
  const ref = isCivilDate(input.dueDate) ? input.dueDate : input.today;
  return (
    `/billings?customer_id=${encodeURIComponent(input.customerId)}` +
    `&type_date=due_day&start_date=${toMikwebDate(addDays(ref, -60))}&end_date=${toMikwebDate(addDays(ref, 1))}&per_page=50`
  );
}

/** Conveniência: resposta crua + id + evento → veredito. Usada pelo `index.ts`. */
export function verdictFromResponse(input: {
  response: unknown;
  invoiceId: string;
  eventKey: string;
}): BillingVerdict {
  return decideBillingVerdict({
    billing: findBilling(input.response, input.invoiceId),
    eventKey: input.eventKey,
  });
}
