/**
 * Apresentação do relatório do simulador de lembretes.
 *
 * Módulo puro (sem React, sem fetch) porque aqui estão as regras que erram fácil:
 * alinhar métrica com a chave de `totals`, contar chips pelo que a tabela REALMENTE
 * mostra em vez de pelo resumo da janela inteira, e explicar por que uma prévia não
 * está no relatório (que quase nunca é "não sairia").
 *
 * Os tipos espelham SimulationReport de `supabase/functions/api/notify/simulate.ts` —
 * o simulador é a fonte da verdade; aqui é só leitura.
 */

export interface SimItem {
  sendDate: string;
  sendDateBR: string;
  dueDate: string;
  dueDateBR: string;
  overdueDays: number;
  ruleKey: string;
  eventKey: string;
  dedupeKey: string;
  customerId: string;
  customerName: string;
  cpfMasked: string;
  phoneMasked: string | null;
  phone: string | null;
  phoneField: string | null;
  reference: string;
  value: number;
  valueWithCharges: number;
  decision: string;
  decisionLabel: string;
  channel: string | null;
  reason: string;
  inNewChatQuota: boolean;
  preview: { title?: string; body: string; url?: string } | null;
}

/** Regra da régua. Espelha `ReminderRule` do núcleo (régua = dados, não código). */
export interface SimRule {
  key: string;
  eventKey: string;
  offsetDays: number;
  active: boolean;
  sortOrder: number;
  label: string;
}

export interface SimChannelSettings {
  enabled: boolean;
  windowStart: number;
  windowEnd: number;
  newChatCapPerDay: number;
  perCustomerCapPerDay: number;
  pausedUntilMs: number | null;
}

/** Configuração efetiva que a rodada usou — vai dentro do relatório. */
export interface SimReportSettings {
  rules: SimRule[];
  horizonDays: number;
  runAtHour: number;
  skipInactiveCustomers: boolean;
  portalBaseUrl: string;
  companyName: string;
  whatsapp: SimChannelSettings;
  fingerprint: string;
  origin: "db" | "defaults";
  updatedAt: number | null;
  updatedBy: string | null;
  activeRuleKeys: string[];
  notes: string[];
}

/** Resposta de `GET /api/admin/notifications/settings`. */
export interface SimSettings extends Omit<SimReportSettings, "activeRuleKeys"> {
  eventKeys: string[];
  maxRules: number;
  defaults: {
    rules: SimRule[];
    horizonDays: number;
    runAtHour: number;
    skipInactiveCustomers: boolean;
    portalBaseUrl: string;
    companyName: string;
  };
}

export interface SimReport {
  dryRun: boolean;
  simulatorVersion: string;
  generatedAt: string;
  window: { from: string; to: string; days: number; runAtHour: number };
  source: {
    kind: string;
    strategy: string;
    customersScanned: number;
    billingsScanned: number;
    truncated: boolean;
    note?: string;
  };
  /** Configuração que produziu este relatório (com fingerprint). */
  settings: SimReportSettings;
  /** Parâmetros que sobrepuseram a configuração persistida nesta rodada. */
  overrides: string[];
  whatsapp: {
    enabled: boolean;
    instanceConnected: boolean;
    windowStart: number;
    windowEnd: number;
    newChatCapPerDay: number;
    perCustomerCapPerDay: number;
    pausedUntil: string | null;
  };
  reach: {
    customers: number;
    withPush: number;
    withWhatsappOptIn: number;
    withValidPhone: number;
    alreadyHaveConversation: number;
    phoneFailures: Record<string, number>;
  };
  plan: {
    billingsScanned: number;
    billingsOpen: number;
    billingsPaid: number;
    billingsCanceled: number;
    billingsUnknownSituation: number;
    billingsInvalidDueDate: number;
    billingsInactiveCustomer: number;
    staleBillings: number;
  };
  totals: {
    candidates: number;
    wouldSend: number;
    deferred: number;
    skipped: number;
    whatsapp: number;
    push: number;
    newConversations: number;
  };
  byDecision: Record<string, number>;
  byRule: Record<string, number>;
  queue: {
    newChatQuotaPerDay: number;
    newChatCandidates: number;
    exhaustionDays: number | null;
    deferredByCap: number;
    deferredByWindow: number;
  };
  assumptions: string[];
  templateWarnings: string[];
  itemsTruncated: boolean;
  items: SimItem[];
  skippedSamples: Array<{ customerName: string; ruleKey: string; reason: string }>;
}

export interface SimParams {
  source: "mikweb" | "synthetic";
  scenario: "realistic" | "stress" | "edge";
  today: string;
  horizon: number;
  at: number;
  cap: number;
  perCustomerCap: number;
  optIn: "auto" | "all" | "none";
  push: "auto" | "all" | "none";
  whatsapp: "on" | "off";
  instance: "up" | "down";
  lockedDays: number;
  limitCustomers: number;
  itemLimit: number;
  previewLimit: number;
  reveal: boolean;
  /** Régua em edição. Igual à salva = manda a config persistida; diferente = override. */
  rules: SimRule[];
}

/**
 * Parâmetros iniciais a partir da configuração persistida.
 *
 * É este seed que garante a propriedade central da tela: **abrir o simulador e rodar
 * sem mexer em nada simula exatamente o que será enviado**. Antes, esses campos
 * começavam em constantes do código (cota 20, hora 10) que podiam divergir do banco.
 */
export function paramsFromSettings(settings: SimSettings): SimParams {
  return {
    source: "mikweb",
    scenario: "realistic",
    today: "",
    horizon: settings.horizonDays,
    at: settings.runAtHour,
    cap: settings.whatsapp.newChatCapPerDay,
    perCustomerCap: settings.whatsapp.perCustomerCapPerDay,
    optIn: "auto",
    push: "auto",
    whatsapp: settings.whatsapp.enabled ? "on" : "off",
    instance: "up",
    lockedDays: 0,
    limitCustomers: 25,
    itemLimit: 500,
    // Toda linha da tabela é expansível, então pedimos a prévia de todas: o teto do
    // endpoint é 200 e renderizar mensagem é barato (nada sai daqui).
    previewLimit: 200,
    reveal: false,
    rules: settings.rules.map((rule) => ({ ...rule })),
  };
}

/** Comparação estável de régua (ordem não importa para a configuração efetiva). */
export function serializeRules(rules: SimRule[]): string {
  return [...rules]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((rule) => [rule.key, rule.eventKey, rule.offsetDays, rule.active ? 1 : 0, rule.sortOrder, rule.label].join(":"))
    .join("|");
}

/**
 * O que está diferente da configuração persistida nesta rodada.
 *
 * Existe para o painel nunca deixar confundir "estou explorando" com "é isto que vai
 * ser enviado": cada item daqui é um override que o backend registra em `overrides`.
 */
export function describeSettingsOverrides(params: SimParams, baseline: SimSettings | null): string[] {
  if (!baseline) return [];
  const changes: string[] = [];
  if (params.horizon !== baseline.horizonDays) changes.push(`horizonte ${baseline.horizonDays} → ${params.horizon} dia(s)`);
  if (params.at !== baseline.runAtHour) changes.push(`hora de execução ${baseline.runAtHour}h → ${params.at}h`);
  if (params.cap !== baseline.whatsapp.newChatCapPerDay) changes.push(`cota de novas conversas ${baseline.whatsapp.newChatCapPerDay} → ${params.cap}`);
  if (params.perCustomerCap !== baseline.whatsapp.perCustomerCapPerDay) {
    changes.push(`cota por cliente ${baseline.whatsapp.perCustomerCapPerDay} → ${params.perCustomerCap}`);
  }
  const channel = baseline.whatsapp.enabled ? "on" : "off";
  if (params.whatsapp !== channel) changes.push(`canal WhatsApp ${channel === "on" ? "ligado → desligado" : "desligado → ligado"}`);
  if (serializeRules(params.rules) !== serializeRules(baseline.rules)) changes.push("régua de lembretes alterada (não salva)");
  return changes;
}

/**
 * Só os parâmetros de configuração que DIVERGEM do que está salvo viram query.
 * Parâmetro ausente no backend significa "use a configuração persistida" — é assim
 * que a rodada padrão é, literalmente, o pipeline de produção.
 */
export function configQuery(params: SimParams, baseline: SimSettings | null): Record<string, string> {
  if (!baseline) {
    return {
      horizon: String(params.horizon),
      at: String(params.at),
      cap: String(params.cap),
      "per-customer-cap": String(params.perCustomerCap),
      whatsapp: params.whatsapp,
    };
  }
  const query: Record<string, string> = {};
  if (params.horizon !== baseline.horizonDays) query.horizon = String(params.horizon);
  if (params.at !== baseline.runAtHour) query.at = String(params.at);
  if (params.cap !== baseline.whatsapp.newChatCapPerDay) query.cap = String(params.cap);
  if (params.perCustomerCap !== baseline.whatsapp.perCustomerCapPerDay) query["per-customer-cap"] = String(params.perCustomerCap);
  if (params.whatsapp !== (baseline.whatsapp.enabled ? "on" : "off")) query.whatsapp = params.whatsapp;
  if (serializeRules(params.rules) !== serializeRules(baseline.rules)) query.rules = JSON.stringify(params.rules);
  return query;
}

/**
 * Problemas da régua em edição, antes de mandar para o servidor.
 *
 * O backend valida de novo (é ele quem manda) — isto aqui é para o admin ver o erro
 * enquanto digita, em vez de descobrir depois de salvar que uma regra foi descartada.
 */
export function validateRules(rules: SimRule[], maxRules: number): string[] {
  const problems: string[] = [];
  if (rules.length > maxRules) problems.push(`a régua aceita no máximo ${maxRules} regras`);
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!/^[a-z0-9][a-z0-9_]{0,31}$/.test(rule.key)) problems.push(`"${rule.key || "(vazia)"}": a chave precisa ser minúscula, sem acento e sem espaço`);
    else if (seen.has(rule.key)) problems.push(`"${rule.key}": chave repetida`);
    seen.add(rule.key);
    if (!Number.isFinite(rule.offsetDays) || Math.abs(rule.offsetDays) > 60) problems.push(`"${rule.key}": deslocamento deve estar entre -60 e 60 dias`);
    if (!rule.key && !rule.label) problems.push("toda regra precisa de chave");
  }
  return problems;
}

/** Diff da régua entre duas rodadas, para o cabeçalho de comparação. */
export function diffRules(before: SimRule[], after: SimRule[]): string[] {
  const changes: string[] = [];
  const byKey = new Map(before.map((rule) => [rule.key, rule]));
  for (const rule of after) {
    const previous = byKey.get(rule.key);
    if (!previous) {
      changes.push(`+${rule.key}(${rule.offsetDays > 0 ? "+" : ""}${rule.offsetDays}d)`);
      continue;
    }
    byKey.delete(rule.key);
    if (previous.active !== rule.active) changes.push(`${rule.key}: ${rule.active ? "ligada" : "desligada"}`);
    if (previous.offsetDays !== rule.offsetDays) changes.push(`${rule.key}: ${previous.offsetDays}d → ${rule.offsetDays}d`);
  }
  for (const removed of byKey.keys()) changes.push(`−${removed}`);
  return changes;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** Cor por família de decisão: envio, fallback, adiamento, descarte. */
export function decisionTone(code: string): string {
  if (code === "send_whatsapp")
    return "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400";
  if (code === "fallback_push")
    return "text-blue-600 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400";
  if (code.startsWith("defer"))
    return "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400";
  return "text-muted-foreground bg-secondary";
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateBR(iso: string): string {
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

// ---------------------------------------------------------------------------
// Contagens (sempre a partir dos itens, para casar com o que a tabela mostra)
// ---------------------------------------------------------------------------

export interface DecisionChip {
  code: string;
  label: string;
  count: number;
}

/**
 * Chips de decisão. Saem dos ITENS, não de `byDecision`: num relatório truncado o
 * resumo conta a janela inteira e um chip prometeria uma contagem que a tabela não
 * consegue mostrar — clicar nele daria "nenhum resultado".
 */
export function buildDecisionChips(report: Pick<SimReport, "items">): DecisionChip[] {
  const byCode = new Map<string, DecisionChip>();
  for (const item of report.items) {
    const existing = byCode.get(item.decision);
    if (existing) existing.count++;
    else
      byCode.set(item.decision, {
        code: item.decision,
        label: item.decisionLabel,
        count: 1,
      });
  }
  return [...byCode.values()].sort((a, b) => b.count - a.count);
}

/** Opções do filtro de regra, pelo mesmo motivo dos chips. */
export function buildRuleOptions(report: Pick<SimReport, "items">): Array<{ key: string; count: number }> {
  const byKey = new Map<string, number>();
  for (const item of report.items) byKey.set(item.ruleKey, (byKey.get(item.ruleKey) ?? 0) + 1);
  return [...byKey.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function filterItems(
  items: SimItem[],
  filters: { decisions?: string[]; ruleKey?: string; search?: string }
): SimItem[] {
  const term = (filters.search ?? "").trim().toLowerCase();
  const decisions = filters.decisions ?? [];
  return items.filter((item) => {
    if (decisions.length && !decisions.includes(item.decision)) return false;
    if (filters.ruleKey && filters.ruleKey !== "all" && item.ruleKey !== filters.ruleKey) return false;
    if (!term) return true;
    return (
      item.customerName.toLowerCase().includes(term) ||
      item.reference.toLowerCase().includes(term) ||
      item.cpfMasked.includes(term)
    );
  });
}

// ---------------------------------------------------------------------------
// Métricas e comparação
// ---------------------------------------------------------------------------

export type MetricKey = keyof SimReport["totals"];

export interface MetricRow {
  key: MetricKey;
  label: string;
  value: number;
  delta: number | null;
  emphasis?: boolean;
}

/** Ordem única das métricas — `key` lê `totals` direto, então rótulo e valor não desalinham. */
const METRIC_DEFS: Array<{ key: MetricKey; label: string; emphasis?: boolean }> = [
  { key: "wouldSend", label: "Seriam enviados", emphasis: true },
  { key: "whatsapp", label: "…por WhatsApp" },
  { key: "push", label: "…por push (fallback)" },
  { key: "deferred", label: "Adiados" },
  { key: "skipped", label: "Ignorados" },
  { key: "newConversations", label: "Novas conversas" },
  { key: "candidates", label: "Candidatos no horizonte" },
];

export function buildMetrics(report: SimReport, reference: SimReport | null): MetricRow[] {
  return METRIC_DEFS.map((def) => ({
    ...def,
    value: report.totals[def.key],
    delta: reference ? report.totals[def.key] - reference.totals[def.key] : null,
  }));
}

/** Nome legível de cada parâmetro, para o cabeçalho da comparação. */
const PARAM_LABELS: Record<keyof SimParams, string> = {
  source: "fonte",
  scenario: "cenário",
  today: "data",
  horizon: "horizonte",
  at: "hora",
  cap: "cota novas conversas",
  perCustomerCap: "cota por cliente",
  optIn: "opt-in",
  push: "push",
  whatsapp: "whatsapp",
  instance: "instância",
  lockedDays: "time-lock",
  limitCustomers: "clientes varridos",
  itemLimit: "itens no relatório",
  previewLimit: "mensagens renderizadas",
  reveal: "revelar telefone",
  rules: "régua de lembretes",
};

export function diffParams(before: SimParams, after: SimParams): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(PARAM_LABELS) as Array<keyof SimParams>) {
    if (key === "rules") {
      // A régua é config, não um número: o diff dela é descrito por regra.
      for (const change of diffRules(before.rules, after.rules)) changed.push(`régua: ${change}`);
      continue;
    }
    if (before[key] !== after[key]) {
      changed.push(`${PARAM_LABELS[key]}: ${String(before[key] || "—")} → ${String(after[key] || "—")}`);
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Prévia ausente
// ---------------------------------------------------------------------------

/**
 * Por que a mensagem não está no relatório.
 *
 * O erro fácil aqui é dizer "não sairia" para tudo: itens adiados carregam o canal
 * (`channel: "whatsapp"`) mas não têm prévia, e avisos que saem podem ficar sem
 * prévia quando o orçamento de renderização acaba. A decisão vem antes do canal.
 */
export function previewFallbackNote(item: SimItem, previewBudget: number): string {
  if (item.decision === "send_whatsapp" || item.decision === "fallback_push") {
    const channel = item.decision === "send_whatsapp" ? "WhatsApp" : "push";
    return `Prévia não renderizada nesta rodada (orçamento de ${previewBudget} mensagens) — este aviso sairia por ${channel}.`;
  }
  if (item.decision.startsWith("defer")) {
    return "Adiado: sai em outro dia — a mensagem é montada no momento do envio.";
  }
  return "Sem mensagem montada — este aviso não sairia.";
}
