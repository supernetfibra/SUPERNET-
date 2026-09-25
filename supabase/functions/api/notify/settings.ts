/**
 * Configuração do pipeline de notificações — módulo PURO (ver `model.ts`).
 *
 * Este arquivo existe para responder uma única pergunta: **qual configuração rege o
 * envio?** Antes dele, a régua vivia em `DEFAULT_RULES` (código) e as cotas vinham de
 * parâmetros de URL com default no código — então o simulador podia dizer uma coisa e
 * o dispatcher fazer outra, sem ninguém perceber. Aqui há **um objeto** e um único
 * caminho de normalização: tudo que entra (linha do banco, query string, arquivo da
 * CLI) passa por `normalizeDocument()`, e o que sai é o que o simulador simula e o
 * dispatcher executa.
 *
 * Duas metades, de propósito:
 *   - `SettingsDocument`   → o que o admin persiste (régua, horizonte, hora, base do
 *                            portal). Mora em `notification_config`.
 *   - `whatsapp`           → o que é do CANAL (cota, janela, ligado/desligado).
 *                            Mora em `whatsapp_config`, lido por `config.ts`.
 * Separar evita dois donos da mesma chave: o canal tem um dono, a régua tem outro.
 *
 * `settingsFingerprint()` fecha o ciclo: o relatório do simulador carrega a impressão
 * digital da configuração usada, então "o que foi simulado" e "o que será enviado"
 * deixam de ser uma promessa verbal e passam a ser dois números que dá para comparar.
 *
 * Sintaxe: apenas "erasable syntax" (sem enum/namespace/parameter properties).
 */

import { DEFAULT_RULES, type ReminderRule } from "./rules.ts";

// ---------------------------------------------------------------------------
// Limites de sanidade (config errada não pode virar disparo errado)
// ---------------------------------------------------------------------------

/** Teto de regras na régua. 12 é folgado para uma cobrança e evita doc gigante. */
export const MAX_RULES = 12;
const RULE_KEY_RE = /^[a-z0-9][a-z0-9_]{0,31}$/;
const MAX_OFFSET_DAYS = 60;
const MIN_OFFSET_DAYS = -60;
const MAX_SORT_ORDER = 999;
const LABEL_MAX = 60;
const MAX_HORIZON_DAYS = 60;
const MAX_CAPS = 100_000;

/** Eventos que possuem template. Regra que aponta para outra coisa não renderiza. */
export const RULE_EVENT_KEYS = ["billing.due_soon", "billing.due_today", "billing.late"] as const;
export type RuleEventKey = (typeof RULE_EVENT_KEYS)[number];

export function isRuleEventKey(value: unknown): value is RuleEventKey {
  return typeof value === "string" && (RULE_EVENT_KEYS as readonly string[]).includes(value);
}

/** Evento coerente com o deslocamento, quando o documento não diz qual é. */
export function eventKeyForOffset(offsetDays: number): RuleEventKey {
  if (offsetDays < 0) return "billing.due_soon";
  if (offsetDays === 0) return "billing.due_today";
  return "billing.late";
}

// ---------------------------------------------------------------------------
// O objeto
// ---------------------------------------------------------------------------

export interface WhatsAppSettings {
  enabled: boolean;
  windowStart: number;
  windowEnd: number;
  newChatCapPerDay: number;
  perCustomerCapPerDay: number;
  /** Estado de runtime (time-lock), não configuração — fora do fingerprint. */
  pausedUntilMs: number | null;
}

/** O que o admin persiste em `notification_config`. */
export interface SettingsDocument {
  rules: ReminderRule[];
  horizonDays: number;
  runAtHour: number;
  skipInactiveCustomers: boolean;
  portalBaseUrl: string;
  companyName: string;
}

export interface NotificationSettings extends SettingsDocument {
  whatsapp: WhatsAppSettings;
}

/**
 * Defaults do código. Servem para **bootstrap** e para o primeiro dia de operação;
 * depois de salvar no painel a linha do banco é a verdade. Toda leitura passa por
 * `normalizeDocument`, então este objeto nunca é devolvido por referência.
 */
const BASE_DOCUMENT: SettingsDocument = {
  rules: DEFAULT_RULES,
  horizonDays: 7,
  runAtHour: 10,
  skipInactiveCustomers: true,
  portalBaseUrl: "https://minhasupernet.com",
  companyName: "MinhaSuperNet",
};

const BASE_WHATSAPP: WhatsAppSettings = {
  enabled: false,
  windowStart: 9,
  windowEnd: 20,
  newChatCapPerDay: 20,
  perCustomerCapPerDay: 1,
  pausedUntilMs: null,
};

export function defaultDocument(): SettingsDocument {
  return normalizeDocument(BASE_DOCUMENT).document;
}

export function defaultWhatsAppSettings(): WhatsAppSettings {
  return { ...BASE_WHATSAPP };
}

export function settingsFrom(document: SettingsDocument, whatsapp: WhatsAppSettings): NotificationSettings {
  return { ...document, rules: document.rules.map((rule) => ({ ...rule })), whatsapp: { ...whatsapp } };
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export interface NormalizedDocument {
  document: SettingsDocument;
  notes: string[];
}

/**
 * Só o que é persistível — usado para gravar e para comparar. Deixar `whatsapp` de
 * fora é o que impede o painel de sobrescrever a config do canal por acidente.
 */
export function documentOf(settings: NotificationSettings): SettingsDocument {
  return {
    rules: settings.rules.map((rule) => ({ ...rule })),
    horizonDays: settings.horizonDays,
    runAtHour: settings.runAtHour,
    skipInactiveCustomers: settings.skipInactiveCustomers,
    portalBaseUrl: settings.portalBaseUrl,
    companyName: settings.companyName,
  };
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Régua vinda de fora → régua utilizável.
 *
 * `fallback` é a régua que vale quando o campo **não foi informado** — e é por isso que
 * ele é parâmetro, não constante: um documento parcial (um POST que só muda a hora, uma
 * query de simulação sem override) precisa preservar a régua em vigor. Usar a régua do
 * código aqui apagava em silêncio a régua salva no painel, que é exatamente o tipo de
 * divergência entre "o que foi simulado" e "o que é enviado" que esta configuração
 * existe para eliminar.
 *
 * Política de falha: campo ausente → mantém a régua em vigor; campo presente mas
 * quebrado → **esvazia** (com nota), nunca "conserta" com o padrão. Esvaziar é o modo de
 * falha seguro (não envia nada errado ao cliente) e a nota aparece no relatório e no
 * retorno do salvamento.
 */
export function sanitizeRules(
  raw: unknown,
  notes: string[],
  context: string,
  fallback: ReminderRule[] = BASE_DOCUMENT.rules
): ReminderRule[] {
  const keepCurrent = () => fallback.map((rule) => ({ ...rule }));

  if (raw === undefined || raw === null) return keepCurrent();
  if (!Array.isArray(raw)) {
    notes.push(`${context}: \`rules\` não é uma lista — régua em vigor mantida`);
    return keepCurrent();
  }

  const out: ReminderRule[] = [];
  const seen = new Set<string>();

  for (const entry of raw.slice(0, MAX_RULES)) {
    const record = asRecord(entry);
    if (!record) {
      notes.push(`${context}: item de régua inválido foi descartado`);
      continue;
    }

    const key = typeof record.key === "string" ? record.key.trim().toLowerCase() : "";
    if (!RULE_KEY_RE.test(key)) {
      notes.push(`${context}: regra sem chave válida foi descartada (${JSON.stringify(record.key ?? null)})`);
      continue;
    }
    if (seen.has(key)) {
      notes.push(`${context}: regra "${key}" duplicada — mantida a primeira`);
      continue;
    }

    const offset = toInt(record.offsetDays);
    if (offset === null) {
      notes.push(`${context}: regra "${key}" descartada — \`offsetDays\` inválido (${JSON.stringify(record.offsetDays ?? null)})`);
      continue;
    }
    const offsetDays = clamp(offset, MIN_OFFSET_DAYS, MAX_OFFSET_DAYS);
    if (offsetDays !== offset) {
      notes.push(`${context}: regra "${key}" com ${offset} dia(s) de deslocamento foi limitada a ${offsetDays}`);
    }

    let eventKey = isRuleEventKey(record.eventKey) ? record.eventKey : null;
    if (!eventKey) {
      eventKey = eventKeyForOffset(offsetDays);
      if (record.eventKey !== undefined && record.eventKey !== null && record.eventKey !== "") {
        notes.push(`${context}: regra "${key}" apontava para evento desconhecido (${JSON.stringify(record.eventKey)}) — usando ${eventKey}`);
      }
    }

    const sortOrderRaw = toInt(record.sortOrder);
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, LABEL_MAX) : key;

    seen.add(key);
    out.push({
      key,
      eventKey,
      offsetDays,
      active: typeof record.active === "boolean" ? record.active : true,
      sortOrder: clamp(sortOrderRaw ?? (out.length + 1) * 10, 0, MAX_SORT_ORDER),
      label,
    });
  }

  if (raw.length > MAX_RULES) {
    notes.push(`${context}: apenas as ${MAX_RULES} primeiras regras foram consideradas`);
  }
  if (out.length === 0 && raw.length > 0) {
    notes.push(
      `${context}: nenhuma das ${raw.length} regras informadas é válida — o pipeline não geraria nenhum aviso até a régua ser corrigida`
    );
  }

  return out;
}

/**
 * Aplica um documento parcial sobre uma base. É o ponto único de merge: linha do
 * banco, corpo do POST, arquivo da CLI e defaults passam todos por aqui.
 */
export function normalizeDocument(raw: unknown, base?: SettingsDocument): NormalizedDocument {
  const fallback = base ?? BASE_DOCUMENT;
  const notes: string[] = [];
  const record = asRecord(raw);

  if (!record) {
    if (raw !== undefined && raw !== null) notes.push("configuração de notificações não é um objeto — usando a régua em vigor");
    return { document: { ...fallback, rules: fallback.rules.map((rule) => ({ ...rule })) }, notes };
  }

  // A base é `fallback` (não a constante): documento parcial preserva a régua em vigor.
  const rules = sanitizeRules(record.rules, notes, "configuração", fallback.rules);

  const horizonRaw = toInt(record.horizonDays);
  const runAtRaw = toInt(record.runAtHour);
  const horizonDays = horizonRaw === null ? fallback.horizonDays : clamp(horizonRaw, 1, MAX_HORIZON_DAYS);
  const runAtHour = runAtRaw === null ? fallback.runAtHour : clamp(runAtRaw, 0, 23);
  if (horizonRaw !== null && horizonRaw !== horizonDays) {
    notes.push(`horizonte de ${horizonRaw} dia(s) foi limitado a ${horizonDays}`);
  }
  if (runAtRaw !== null && runAtRaw !== runAtHour) {
    notes.push(`hora de execução ${runAtRaw}h foi limitada a ${runAtHour}h`);
  }

  const portalBaseUrl =
    typeof record.portalBaseUrl === "string" && record.portalBaseUrl.trim()
      ? record.portalBaseUrl.trim().replace(/\/+$/, "")
      : fallback.portalBaseUrl;
  const companyName =
    typeof record.companyName === "string" && record.companyName.trim()
      ? record.companyName.trim().slice(0, 80)
      : fallback.companyName;

  return {
    document: {
      rules,
      horizonDays,
      runAtHour,
      skipInactiveCustomers:
        typeof record.skipInactiveCustomers === "boolean" ? record.skipInactiveCustomers : fallback.skipInactiveCustomers,
      portalBaseUrl,
      companyName,
    },
    notes,
  };
}

/**
 * Normaliza a metade do CANAL.
 *
 * Em produção esses valores vêm de `whatsapp_config` (já limitados por `config.ts`);
 * este normalizador serve para a única outra porta de entrada: o arquivo que a CLI
 * lê. Sem ele, um `--settings` editado à mão com janela 30h passaria direto.
 */
export function normalizeWhatsApp(raw: unknown, base: WhatsAppSettings = BASE_WHATSAPP): { whatsapp: WhatsAppSettings; notes: string[] } {
  const notes: string[] = [];
  const record = asRecord(raw);
  if (!record) {
    if (raw !== undefined && raw !== null) notes.push("bloco `whatsapp` não é um objeto — valores do canal ignorados");
    return { whatsapp: { ...base }, notes };
  }

  const windowStartRaw = toInt(record.windowStart);
  const windowEndRaw = toInt(record.windowEnd);
  const capRaw = toInt(record.newChatCapPerDay);
  const perCustomerRaw = toInt(record.perCustomerCapPerDay);

  const windowStart = windowStartRaw === null ? base.windowStart : clamp(windowStartRaw, 0, 23);
  const windowEnd = windowEndRaw === null ? base.windowEnd : clamp(windowEndRaw, 1, 24);
  if (windowEnd <= windowStart) {
    notes.push(`janela inválida (${windowStart}h–${windowEnd}h) — mantida a anterior (${base.windowStart}h–${base.windowEnd}h)`);
    return { whatsapp: { ...base }, notes };
  }

  const newChatCapPerDay = capRaw === null ? base.newChatCapPerDay : clamp(capRaw, 0, MAX_CAPS);
  const perCustomerCapPerDay = perCustomerRaw === null ? base.perCustomerCapPerDay : clamp(perCustomerRaw, 1, MAX_CAPS);

  return {
    whatsapp: {
      enabled: typeof record.enabled === "boolean" ? record.enabled : base.enabled,
      windowStart,
      windowEnd,
      newChatCapPerDay,
      perCustomerCapPerDay,
      // Estado de runtime (time-lock): só faz sentido vir de quem sabe do canal.
      pausedUntilMs: base.pausedUntilMs,
    },
    notes,
  };
}

/**
 * A régua efetiva está de fato ativa? Um documento válido com todas as regras
 * desligadas é uma pausa legítima — mas precisa aparecer no relatório, não virar
 * silêncio.
 */
export function activeRules(rules: ReminderRule[]): ReminderRule[] {
  return rules.filter((rule) => rule.active);
}

// ---------------------------------------------------------------------------
// Impressão digital
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32 bits sobre uma serialização canônica.
 *
 * Não é hash criptográfico: o objetivo é comparar duas configurações por igualdade
 * (o relatório do simulador contra o que o dispatcher vai ler). Por isso a
 * serialização é construída explicitamente — depender da ordem de chaves de um
 * `JSON.stringify` de objeto daria fingerprints diferentes para a mesma config.
 *
 * Fora do cálculo: `pausedUntilMs` (estado de time-lock) e qualquer coisa de runtime.
 */
export function settingsFingerprint(settings: NotificationSettings): string {
  const parts: string[] = ["s1"];

  const rules = [...settings.rules].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  parts.push(rules.map((rule) => [rule.key, rule.eventKey, rule.offsetDays, rule.active ? 1 : 0, rule.sortOrder, rule.label].join(":")).join("|"));

  parts.push(
    [
      settings.horizonDays,
      settings.runAtHour,
      settings.skipInactiveCustomers ? 1 : 0,
      settings.portalBaseUrl,
      settings.companyName,
    ].join(",")
  );
  parts.push(
    [
      settings.whatsapp.enabled ? 1 : 0,
      settings.whatsapp.windowStart,
      settings.whatsapp.windowEnd,
      settings.whatsapp.newChatCapPerDay,
      settings.whatsapp.perCustomerCapPerDay,
    ].join(",")
  );

  let hash = 2166136261;
  const canonical = parts.join("~");
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `s1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Resumo legível (CLI, logs e relatório)
// ---------------------------------------------------------------------------

/** Ex.: `d_minus_3(-3d) · due_day(0d) · late_1(+1d)` — desligadas marcadas com ✕. */
export function describeRules(rules: ReminderRule[]): string {
  if (!rules.length) return "nenhuma regra";
  return [...rules]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.offsetDays - b.offsetDays)
    .map((rule) => `${rule.active ? "" : "✕"}${rule.key}(${rule.offsetDays > 0 ? "+" : ""}${rule.offsetDays}d)`)
    .join(" · ");
}

export function describeWhatsApp(settings: WhatsAppSettings): string {
  const watermark = settings.newChatCapPerDay > 0 ? `${settings.newChatCapPerDay}/dia` : "sem teto de novas conversas";
  return `${settings.enabled ? "ligado" : "desligado"} · janela ${settings.windowStart}h–${settings.windowEnd}h · ${watermark} · ${settings.perCustomerCapPerDay}/cliente`;
}
