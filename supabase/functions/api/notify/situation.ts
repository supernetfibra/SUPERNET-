/**
 * Classificação da situação da fatura do ERP — FONTE ÚNICA.
 *
 * O portal (área do cliente, `src/lib/billing-utils.ts` → `mapStatus`) e o pipeline
 * de lembretes (`./model.ts` → `classifyBilling`) precisam ler a MESMA situação do
 * mesmo jeito. Antes esta regra vivia duplicada nos dois arquivos, mantida à mão:
 * uma edição em um só lado reabria a divergência que fez o portal cobrar um acordo
 * que os lembretes já haviam cancelado.
 *
 * Por que aqui dentro (e não em `src/`): o deploy da Edge Function empacota apenas
 * a pasta da função (`supabase/functions/api`), então o pipeline NÃO consegue
 * importar de `src/`. O portal, por outro lado, consegue importar daqui (Vite/tsc
 * atravessam o diretório sem problema). Por isso a fonte única mora no lado do
 * pipeline e o frontend depende dela.
 *
 * Regra deste módulo: nada de I/O, nada de `esm.sh`, nada de globais do Deno —
 * roda igual no Deno, no Node (type stripping) e no bundle do Vite. Sintaxe apenas
 * "erasable" (sem enum/namespace/parameter properties).
 */

/**
 * Normaliza a grafia da situação: remove acentos (NFD + strip combining) e baixa
 * a caixa. É o ÚNICO ponto de normalização — o portal e o pipeline leem a mesma
 * situação mesmo que o ERP escreva "em observação", "EM OBSERVACAO" ou "Em Observacao".
 */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Estado DETALHADO da situação. Preserva o que cada lado precisa:
 *  - o portal distingue `pending` ("Em Aberto") de `overdue` ("Em Atraso"/"Vencido");
 *  - o pipeline separa `unknown` (não entendeu → bloqueia o envio) de `pending`.
 * Cada consumidor projeta este detalhe para o seu vocabulário, sem reclassificar.
 */
export type SituationKind =
  | "pending"
  | "overdue"
  | "paid"
  | "canceled"
  | "observation"
  | "unknown";

/**
 * Classifica a situação do ERP pelo texto (aceita acento/caixa e texto extra,
 * ex.: "Em Observação - Acordo").
 *
 * A ORDEM importa e é espelhada nos dois consumidores:
 *  1. cancelamento e pagamento vencem observação — "Em Observação - Quitado" é
 *     PAGO, "Em Observação - Cancelado" é CANCELADO, não acordo;
 *  2. `observation` ("Em Observação") é estado PRÓPRIO, nunca fatura cobrável;
 *  3. `overdue` antes de `pending` para preservar o rótulo mais preciso do portal
 *     quando o texto tem ambos (ex.: "Em Aberto - Vencido" é `overdue`);
 *  4. nada reconhecido → `unknown` (o pipeline bloqueia; o portal mostra "Pendente"
 *     como fallback de exibição, decisão de cada lado).
 */
export function classifySituation(situationName?: string | null): SituationKind {
  const name = stripAccents(String(situationName ?? "").trim());
  if (!name) return "unknown";
  if (name.includes("cansel") || name.includes("cancel")) return "canceled";
  if (
    name.includes("efetuad") ||
    name.includes("quitad") ||
    name.includes("pag") ||
    name.includes("baixad")
  ) {
    return "paid";
  }
  if (name.includes("observa")) return "observation";
  if (name.includes("atras") || name.includes("vencid")) return "overdue";
  if (name.includes("aberto") || name.includes("pendent")) return "pending";
  return "unknown";
}
