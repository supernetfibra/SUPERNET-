#!/usr/bin/env node
/**
 * Invariantes do mapeamento situação → status do portal e dos rótulos das faturas
 * (área do cliente).
 *
 * O projeto não tem framework de teste, mas aqui o erro é silencioso e caro: uma
 * fatura em acordo ("Em Observação") mapeada para `pendente` fazia o portal cobrar
 * o cliente — badge de prazo, contador de "vencidas", card "pague isto" — enquanto
 * o pipeline de lembretes CANCELA a cobrança dessas mesmas faturas. Duas telas
 * discordando sobre a mesma fatura, sem nenhum sinal.
 *
 * Uma variação de grafia ou um texto extra na MESMA situação ("em observação",
 * "EM OBSERVACAO", "Em Observação - Acordo") caía no fallback `pendente` e cobrava
 * o acordo. Hoje a detecção mora numa FONTE ÚNICA
 * (`supabase/functions/api/notify/situation.ts`) da qual `mapStatus` e
 * `classifyBilling()` são só projeções — a §1 fixa o portal, a §2 cruza os dois lados
 * e a §2b fixa o contrato da fonte única.
 *
 * Cada seção verifica o código real, importado do app (Node roda os módulos TS
 * direto, sem build). Para isso os rótulos do card vivem num módulo puro,
 * `src/lib/billing-labels.ts` (sem React), e `status-config.ts` importa o helper
 * com extensão explícita:
 *
 *   1. mapStatus      — situação do ERP → status do portal (normaliza acento/caixa + texto extra)
 *   2. portal × pipeline — os dois lados do produto concordam sobre a situação
 *   2b. fonte única    — os dois derivam do mesmo classificador (`situation.ts`)
 *   3. statusConfig   — o rótulo e a cor de cada status
 *   4. statusBadge    — o rótulo exibido (e o prazo) por status
 *   5. getSmartLabel  — o texto do cabeçalho do card de fatura
 *   6. mapBilling     — a fatura crua vira status + campos coerentes
 *
 * Uso:  node scripts/check-portal-billing.mjs   (ou `npm run check:portal`)
 */

import { mapBilling, mapStatus } from "../src/lib/billing-utils.ts";
import { statusConfig, statusBadge } from "../src/lib/status-config.ts";
import {
  extractMesInfo,
  formatVencimentoComMes,
  getSmartLabel,
} from "../src/lib/billing-labels.ts";
import { classifyBilling } from "../supabase/functions/api/notify/model.ts";
import { classifySituation } from "../supabase/functions/api/notify/situation.ts";

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else failures.push(`${name}${extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
function section(title) {
  console.log(`\n  ${title}`);
}

/** Data civil (dd/MM/yyyy) a `offsetDays` de hoje, no fuso local — o mesmo que
 *  `diasAteVencimento()` enxerga. Mantém o check independente do dia da execução. */
function brDate(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
const MESES_BR = [
  "Janeiro", "Fevereiro", "Março", "Abril",
  "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro",
];
function expectedComMes(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getDate()} de ${MESES_BR[d.getMonth()]} de ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// 1. mapStatus — situação do ERP → status do portal
// ---------------------------------------------------------------------------
section("1. mapStatus: situação do ERP → status do portal");

eq('"Em Aberto" → pendente', mapStatus("Em Aberto"), "pendente");
eq('"Efetuado" → pago', mapStatus("Efetuado"), "pago");
eq('"Pago" → pago', mapStatus("Pago"), "pago");
eq('"Em Atraso" → vencido', mapStatus("Em Atraso"), "vencido");
eq('"Vencido" → vencido', mapStatus("Vencido"), "vencido");
eq('"Cancelado" → cancelado', mapStatus("Cancelado"), "cancelado");

// A regressão: "Em Observação" (acordo) é estado PRÓPRIO, nunca `pendente`.
// Mapeá-la para pendente é o que fazia o portal cobrar um acordo.
eq('"Em Observação" → observacao (e não pendente)', mapStatus("Em Observação"), "observacao");

// Grafia: o ERP varia acento/caixa na MESMA situação. `mapStatus` normaliza como
// `classifyBilling()`; sem isso {"em observação"} caía no fallback `pendente` e o
// portal cobrava um acordo por pura variação de escrita.
for (const [situation, expected] of [
  ["em observação", "observacao"],
  ["EM OBSERVAÇÃO", "observacao"],
  ["Em Observacao", "observacao"],
  ["EM OBSERVACAO", "observacao"],
  ["em observacao", "observacao"],
  ["  Em Observação  ", "observacao"],
  ["em aberto", "pendente"],
  ["EM ABERTO", "pendente"],
  ["efetuado", "pago"],
  ["EFETUADO", "pago"],
  ["em atraso", "vencido"],
  ["EM ATRASO", "vencido"],
  ["vencido", "vencido"],
  ["VENCIDO", "vencido"],
  ["cancelado", "cancelado"],
  ["CANCELADO", "cancelado"],
]) {
  eq(`grafia "${situation}" → ${expected}`, mapStatus(situation), expected);
}

// Texto extra anexado à situação: o ERP manda "Em Observação - Acordo" e similares.
// Sem a detecção por palavra-chave, a string inteira caía no fallback `pendente` e
// o portal cobrava o acordo. A ordem (quitado antes de observação) espelha o pipeline.
for (const [situation, expected] of [
  ["Em Observação - Acordo", "observacao"],
  ["Em Observacao - acordo", "observacao"],
  ["Acordo: Em Observação", "observacao"],
  ["Observação", "observacao"],
  ["Em Observação (acordo firmado)", "observacao"],
  ["Em Observação - Quitado", "pago"],
  ["Em Observação - Cancelado", "cancelado"],
  ["Vencido - Acordo", "vencido"],
  ["Em Aberto - Negociação", "pendente"],
  ["Baixado", "pago"],
]) {
  eq(`texto extra "${situation}" → ${expected}`, mapStatus(situation), expected);
}

// Situação fora do vocabulário do ERP: o fallback é `pendente` (fatura em aberto),
// nunca `observacao` — desconhecido não vira acordo silenciosamente.
eq("situação vazia → pendente (fallback)", mapStatus(""), "pendente");
eq("situação só espaços → pendente (fallback)", mapStatus("   "), "pendente");
eq("situação desconhecida → pendente (fallback)", mapStatus("Situação Inventada"), "pendente");
check(
  "nenhuma situação fora da lista vira observacao por engano",
  mapStatus("Em Analise") !== "observacao" && mapStatus("Baixado") !== "observacao",
  { analise: mapStatus("Em Analise"), baixado: mapStatus("Baixado") },
);

// ---------------------------------------------------------------------------
// 2. Portal × pipeline — os dois lados concordam sobre a mesma situação
// ---------------------------------------------------------------------------
section("2. Portal e pipeline concordam (mapStatus × classifyBilling)");

// `classifyBilling()` (notify/model.ts) se declara "espelho de mapStatus()". Se os
// dois divergirem, o portal cobra o que o lembretes cancelou (ou o contrário).
const PIPELINE_STATE_OF_PORTAL_STATUS = {
  pendente: "open",
  vencido: "open",
  pago: "paid",
  cancelado: "canceled",
  observacao: "observation",
};
const CANONICAL_SITUATIONS = [
  "Em Aberto", "Efetuado", "Pago", "Em Atraso", "Vencido", "Cancelado", "Em Observação",
];
// As variações de grafia também precisam concordar: se `mapStatus` normaliza mas
// `classifyBilling` não (ou vice-versa), o lado que ficou exato cobra o acordo.
const SPELLING_VARIANTS = [
  "em observação", "EM OBSERVAÇÃO", "Em Observacao", "EM OBSERVACAO", "  Em Observação  ",
  "em aberto", "EM ABERTO",
  "efetuado", "EFETUADO",
  "em atraso", "EM ATRASO",
  "vencido", "VENCIDO",
  "cancelado", "CANCELADO",
];
// Texto extra da mesma situação — aqui é onde portal e pipeline mais divergiam.
// Inclui as armadilhas de ordem: o que tem "quitado"/"cancelado" junto com
// "observação" tem de ser pago/cancelado nos DOIS lados, não acordo.
const EXTRA_TEXT_SITUATIONS = [
  "Em Observação - Acordo",
  "Em Observacao - acordo",
  "Acordo: Em Observação",
  "Observação",
  "Em Observação (acordo firmado)",
  "Em Observação - Quitado",
  "Em Observação - Cancelado",
  "Vencido - Acordo",
  "Em Aberto - Negociação",
  "Baixado",
];
for (const situation of [...CANONICAL_SITUATIONS, ...SPELLING_VARIANTS, ...EXTRA_TEXT_SITUATIONS]) {
  eq(
    `"${situation}": portal e pipeline leem o mesmo estado`,
    PIPELINE_STATE_OF_PORTAL_STATUS[mapStatus(situation)],
    classifyBilling(situation),
  );
}
// O caso que importa: acordo é acordo nos DOIS lados.
eq('"Em Observação": portal = observacao', mapStatus("Em Observação"), "observacao");
eq('"Em Observação": pipeline = observation', classifyBilling("Em Observação"), "observation");

// ---------------------------------------------------------------------------
// 2b. Fonte única — os dois lados derivam do MESMO classificador
// ---------------------------------------------------------------------------
section("2b. Fonte única: portal e pipeline derivam do mesmo classificador");

// A detecção mora em `supabase/functions/api/notify/situation.ts`. `mapStatus` e
// `classifyBilling` são agora só PROJEÇÕES deste estado detalhado. A §2 prova a
// concordância; aqui fixamos o contrato da fonte única para uma futura regressão
// em que um dos lados volte a reclassificar por conta própria.
const KIND_OF_SITUATION = {
  "Em Aberto": "pending",
  "Em Atraso": "overdue",
  "Vencido": "overdue",
  "Pago": "paid",
  "Cancelado": "canceled",
  "Em Observação": "observation",
  "Situação Inventada": "unknown",
};
for (const [situation, kind] of Object.entries(KIND_OF_SITUATION)) {
  eq(`classifySituation("${situation}") → ${kind}`, classifySituation(situation), kind);
}
eq('grafia/accento: "EM OBSERVACAO" → observation', classifySituation("EM OBSERVACAO"), "observation");
eq('texto extra: "Em Observação - Quitado" → paid', classifySituation("Em Observação - Quitado"), "paid");

// Cada lado projeta o MESMO detalhe para o seu vocabulário:
eq("pending → portal pendente", mapStatus("Em Aberto"), "pendente");
eq("overdue → portal vencido (detalhe preservado)", mapStatus("Em Atraso"), "vencido");
eq("pending → pipeline open", classifyBilling("Em Aberto"), "open");
eq("overdue → pipeline open (colapsado)", classifyBilling("Em Atraso"), "open");
// `unknown` é decisão de cada lado: o portal mostra "Pendente" (exibição), o
// pipeline bloqueia o envio — a distinção que a fonte única precisa preservar.
eq("unknown → portal pendente (fallback de exibição)", mapStatus("Situação Inventada"), "pendente");
eq("unknown → pipeline unknown (bloqueia envio)", classifyBilling("Situação Inventada"), "unknown");

// ---------------------------------------------------------------------------
// 3. statusConfig — rótulo e cor de cada status
// ---------------------------------------------------------------------------
section("3. statusConfig: rótulo e cor de cada status");

eq("pendente", statusConfig.pendente.label, "Pendente");
eq("pago", statusConfig.pago.label, "Pago");
eq("vencido", statusConfig.vencido.label, "Vencido");
eq("cancelado", statusConfig.cancelado.label, "Cancelado");
eq("observacao", statusConfig.observacao.label, "Em acordo");
// Todo status que `mapStatus` pode produzir precisa de config — senão o badge cai
// no fallback e mostra o rótulo errado.
for (const status of Object.keys(PIPELINE_STATE_OF_PORTAL_STATUS)) {
  check(`statusConfig tem entrada para "${status}"`, typeof statusConfig[status]?.label === "string", statusConfig[status]);
}
// Acordo é informativo (azul), nunca âmbar/vermelho: a cor não pode pedir pagamento.
check("observacao usa cor informativa (sky)", /sky/.test(statusConfig.observacao.color), statusConfig.observacao.color);
check("observacao não usa vermelho/âmbar", !/(red|amber)/.test(statusConfig.observacao.color), statusConfig.observacao.color);
check("observacao tem ícone próprio", Boolean(statusConfig.observacao.icon));
check("o ícone do acordo difere do de vencido", statusConfig.observacao.icon !== statusConfig.vencido.icon);

// ---------------------------------------------------------------------------
// 4. statusBadge — o rótulo exibido (e o prazo) por status
// ---------------------------------------------------------------------------
section("4. statusBadge: rótulo exibido por status");

// Pendente refina pelo prazo…
eq("pendente vencendo hoje → \"Vence hoje\"", statusBadge("pendente", brDate(0)).label, "Vence hoje");
eq("pendente futuro → \"A vencer\"", statusBadge("pendente", brDate(5)).label, "A vencer");
eq("pendente atrasado (ERP ainda \"Em Aberto\") → \"Pendente\"", statusBadge("pendente", brDate(-3)).label, "Pendente");
eq("pendente sem data válida → \"Pendente\"", statusBadge("pendente", "data-invalida").label, "Pendente");

// …os outros status mantêm o rótulo do config.
for (const [status, label] of [["pago", "Pago"], ["vencido", "Vencido"], ["cancelado", "Cancelado"], ["observacao", "Em acordo"]]) {
  eq(`statusBadge "${status}" → "${label}"`, statusBadge(status, brDate(-10)).label, label);
}
// Acordo NUNCA ganha prazo, qualquer que seja a data.
eq("acordo com data de hoje ainda é \"Em acordo\"", statusBadge("observacao", brDate(0)).label, "Em acordo");
eq("acordo com data futura ainda é \"Em acordo\"", statusBadge("observacao", brDate(5)).label, "Em acordo");
eq("acordo sem data ainda é \"Em acordo\"", statusBadge("observacao", "").label, "Em acordo");
check("acordo não é \"Vence hoje\" nem \"A vencer\"",
  !["Vence hoje", "A vencer"].includes(statusBadge("observacao", brDate(0)).label));
// Status desconhecido cai no config de pendente, sem refinar prazo.
eq("status desconhecido → \"Pendente\" (fallback, sem prazo)", statusBadge("zzz", brDate(0)).label, "Pendente");

// ---------------------------------------------------------------------------
// 5. getSmartLabel — o texto do cabeçalho do card
// ---------------------------------------------------------------------------
section("5. getSmartLabel: texto do cabeçalho do card");

const bill = (status, vencimento = brDate(0)) => ({ status, vencimento });

eq("pago", getSmartLabel(bill("pago")), { text: "Paga", type: "paga" });
eq("cancelado", getSmartLabel(bill("cancelado")), { text: "Cancelada", type: "normal" });
eq("observacao → \"Em acordo\"", getSmartLabel(bill("observacao")), { text: "Em acordo", type: "normal" });
eq("vencido atrasado", getSmartLabel(bill("vencido", brDate(-5))), { text: "VENCIDA", type: "vencida" });
eq("vencido vencendo hoje", getSmartLabel(bill("vencido", brDate(0))), { text: "VENCE HOJE", type: "vence-hoje" });
eq("pendente vencendo hoje", getSmartLabel(bill("pendente", brDate(0))), { text: "VENCE HOJE", type: "vence-hoje" });
eq("pendente em 1 dia (singular)", getSmartLabel(bill("pendente", brDate(1))), { text: "A VENCER em 1 dia", type: "a-vencer" });
eq("pendente em 3 dias", getSmartLabel(bill("pendente", brDate(3))), { text: "A VENCER em 3 dias", type: "a-vencer" });
eq("pendente em 10 dias (janela longa)", getSmartLabel(bill("pendente", brDate(10))), { text: "A vencer em 10 dias", type: "normal" });
eq("pendente longe → data por extenso", getSmartLabel(bill("pendente", brDate(40))), { text: expectedComMes(40), type: "normal" });
eq("pendente sem data válida", getSmartLabel(bill("pendente", "")), { text: "Pendente", type: "normal" });

// Acordo nunca cobra: nenhum rótulo de prazo, em nenhuma data.
for (const offset of [-30, -1, 0, 1, 7, 30, 90]) {
  const label = getSmartLabel(bill("observacao", brDate(offset)));
  check(`acordo (${offset}d) não anuncia prazo`, label.text === "Em acordo" && label.type === "normal", label);
}

// formatVencimentoComMes / extractMesInfo — bases do rótulo por extenso.
eq("formatVencimentoComMes", formatVencimentoComMes("15/01/2026"), "15 de Janeiro de 2026");
eq("formatVencimentoComMes não-zero-pad", formatVencimentoComMes("03/03/2025"), "3 de Março de 2025");
eq("formatVencimentoComMes inválido devolve a entrada", formatVencimentoComMes("15/01"), "15/01");
eq("extractMesInfo", extractMesInfo("15/01/2026"), { mesNome: "Janeiro", mesAno: "2026-01", ano: "2026", mes: "01", dia: "15" });
eq("extractMesInfo mês inválido → null", extractMesInfo("15/13/2026"), null);
eq("extractMesInfo vazio → null", extractMesInfo(""), null);

// ---------------------------------------------------------------------------
// 6. mapBilling — a fatura crua vira status + campos coerentes
// ---------------------------------------------------------------------------
section("6. mapBilling: fatura crua → status do portal");

const obs = mapBilling({ id: 1007, reference: "Setembro/2026", due_day: "2026-09-15", value: 129.9, situation_name: "Em Observação" });
eq("situação \"Em Observação\" chega ao status do portal", obs.status, "observacao");
eq("id vira string", obs.id, "1007");
eq("referência vira competência", obs.competencia, "Setembro/2026");
eq("due_day (ISO) vira vencimento (BR)", obs.vencimento, "15/09/2026");
eq("valor preservado", obs.valor, 129.9);

// A grafia varia na fatura crua também — o status tem que continuar sendo acordo.
for (const spelling of [
  "em observação", "EM OBSERVACAO", "Em Observacao", "  Em Observação  ",
  "Em Observação - Acordo", "Acordo: Em Observação",
]) {
  eq(
    `fatura crua com grafia "${spelling}" ainda é acordo`,
    mapBilling({ id: 7, situation_name: spelling }).status,
    "observacao",
  );
}

const paid = mapBilling({ id: 1, due_day: "2026-06-10", value: 50, situation_name: "Efetuado", date_payment: "2026-06-09", value_paid: 50 });
eq("pago + data de pagamento BR", [paid.status, paid.data_pagamento, paid.valor_pago], ["pago", "09/06/2026", 50]);

const unknown = mapBilling({ id: 2, situation_name: "???" });
eq("situação desconhecida → pendente", unknown.status, "pendente");
eq("valor ausente → 0", unknown.valor, 0);
eq("referência ausente → competência vazia", unknown.competencia, "");

// ---------------------------------------------------------------------------

console.log(`\n${failures.length === 0 ? "✓" : "✗"} ${pass} verificações passaram, ${failures.length} falharam`);
for (const item of failures) console.log(`  ✗ ${item}`);
process.exit(failures.length === 0 ? 0 : 1);
