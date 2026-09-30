/**
 * Persistência da configuração do pipeline de notificações.
 *
 * Espelha o padrão que já existe para a MikWeb e para a UazAPI: o backend lê, o
 * painel admin escreve, e o simulador lê **a mesma linha** que o dispatcher lê. Não
 * existe configuração "só da simulação": parâmetro que não está gravado é declarado
 * como override no relatório (`overrides`), nunca aplicado em silêncio.
 *
 * Duas tabelas, dois donos (ver `settings.ts`):
 *   notification_config  → régua, horizonte, hora de execução (este arquivo)
 *   whatsapp_config      → cota, janela, ligado/desligado (via `getChannelConfig`)
 *
 * O canal é lido pelo `getWhatsAppConfig` de `config.ts` — **não** por uma consulta
 * própria. Seria fácil ler `whatsapp_config` direto aqui, e aí a cota que o
 * simulador mostra passaria a divergir da que o dispatcher usa. Um leitor por tabela.
 *
 * Dependências injetadas: este módulo roda fora do Deno, em teste.
 */

import type { SupabaseLike } from "./outbox.ts";
import type { WhatsAppConfig } from "./config.ts";
import { loadTemplates } from "./template-store.ts";
import {
  SETTINGS_TABLE,
  SETTINGS_KEY,
  defaultDocument,
  defaultWhatsAppSettings,
  documentOf,
  normalizeDocument,
  settingsFingerprint,
  settingsFrom,
  type NotificationSettings,
  type SettingsDocument,
  type WhatsAppSettings,
} from "./settings.ts";

export interface SettingsStoreDeps {
  db: () => SupabaseLike;
  /** Leitor oficial de `whatsapp_config` (ver cabeçalho). */
  getChannelConfig: () => Promise<WhatsAppConfig>;
  now?: () => number;
}

export interface LoadedSettings {
  settings: NotificationSettings;
  document: SettingsDocument;
  /** `db` = veio da linha salva; `defaults` = nada salvo (ou tabela ausente). */
  origin: "db" | "defaults";
  fingerprint: string;
  /** Tudo que precisou ser corrigido/assumido na leitura — aparece no relatório. */
  notes: string[];
  updatedAt: number | null;
  updatedBy: string | null;
}

export function whatsAppSettingsFrom(config: WhatsAppConfig): WhatsAppSettings {
  return {
    enabled: config.enabled,
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    newChatCapPerDay: config.dailyNewChatCap,
    perCustomerCapPerDay: config.perCustomerCap,
    pausedUntilMs: config.pausedUntil,
  };
}

function toTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

async function readChannel(deps: SettingsStoreDeps, config?: WhatsAppConfig): Promise<WhatsAppSettings> {
  if (config) return whatsAppSettingsFrom(config);
  try {
    return whatsAppSettingsFrom(await deps.getChannelConfig());
  } catch {
    // Sem config de canal o simulador ainda funciona (canal desligado é o default
    // seguro): não faz sentido derrubar o relatório inteiro por isso.
    return defaultWhatsAppSettings();
  }
}

/**
 * Configuração efetiva do pipeline.
 *
 * `options.channel` evita reler `whatsapp_config` quando a rota já leu (a rota de
 * simulate lê para mostrar o status da instância).
 */
export async function loadNotificationSettings(
  deps: SettingsStoreDeps,
  options: { channel?: WhatsAppConfig; hash?: boolean } = {}
): Promise<LoadedSettings> {
  const whatsapp = await readChannel(deps, options.channel);
  const notes: string[] = [];

  let row: Record<string, unknown> | null = null;
  let tableMissing = false;
  try {
    const { data, error } = await deps.db().from(SETTINGS_TABLE).select("settings, updated_at, updated_by").eq("key", SETTINGS_KEY).maybeSingle();
    if (error) tableMissing = true;
    else row = (data ?? null) as Record<string, unknown> | null;
  } catch {
    tableMissing = true;
  }

  const stored = row?.settings;
  const hasStored = stored !== null && stored !== undefined && (typeof stored !== "object" || Object.keys(stored as object).length > 0);
  const normalized = normalizeDocument(hasStored ? stored : undefined, defaultDocument());
  notes.push(...normalized.notes);

  // Templates da mesma linha: entram no fingerprint (pelos desvios do padrão) e no
  // que o simulador renderiza. Falha de leitura degrada para o texto do código.
  let templates;
  try {
    templates = (await loadTemplates({ db: deps.db, now: deps.now })).templates;
  } catch {
    templates = undefined;
  }

  const origin: LoadedSettings["origin"] = hasStored ? "db" : "defaults";
  if (tableMissing) {
    notes.push(`${SETTINGS_TABLE} não pôde ser lida (migration 004 pendente?) — a régua padrão do código está em vigor`);
  } else if (!hasStored) {
    notes.push("nenhuma configuração salva ainda — a régua padrão do código está em vigor; salve no painel para fixá-la");
  }

  const settings = { ...settingsFrom(normalized.document, whatsapp), templates };
  return {
    settings,
    document: normalized.document,
    origin,
    fingerprint: settingsFingerprint(settings),
    notes,
    updatedAt: toTime(row?.updated_at),
    updatedBy: row?.updated_by === null || row?.updated_by === undefined ? null : String(row.updated_by),
  };
}

export interface SaveOptions {
  /** Quem salvou — entra na auditoria e na linha. */
  updatedBy?: string;
}

export type SaveSettingsResult =
  | { ok: true; loaded: LoadedSettings; notes: string[] }
  | { ok: false; error: string };

/**
 * Grava um documento **parcial**: só as chaves presentes no corpo são alteradas (a
 * base é o documento em vigor). Assim um POST que manda apenas `horizonDays` não
 * apaga a régua — que é o tipo de erro que só aparece depois de enviar.
 */
export async function saveNotificationSettings(
  deps: SettingsStoreDeps,
  patch: unknown,
  options: SaveOptions = {}
): Promise<SaveSettingsResult> {
  const current = await loadNotificationSettings(deps);
  const normalized = normalizeDocument(patch, current.document);
  const settings = settingsFrom(normalized.document, current.settings.whatsapp);
  const now = deps.now?.() ?? Date.now();

  try {
    // `documentOf` só conhece os campos da régua — e os TEMPLATES moram na mesma
    // linha. Sem o merge abaixo, salvar a régua apagava em silêncio as mensagens
    // editadas no painel (e vice-versa já é tratado no `saveTemplates`).
    const { data: existingRow } = await deps
      .db()
      .from(SETTINGS_TABLE)
      .select("settings")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const existingDoc: Record<string, unknown> =
      existingRow && typeof existingRow.settings === "object" && existingRow.settings !== null
        ? (existingRow.settings as Record<string, unknown>)
        : {};
    const mergedDoc: Record<string, unknown> = { ...existingDoc, ...documentOf(settings) } as Record<string, unknown>;

    const { error } = await deps.db()
      .from(SETTINGS_TABLE)
      .upsert(
        {
          key: SETTINGS_KEY,
          settings: mergedDoc,
          updated_at: now,
          updated_by: options.updatedBy ?? "admin",
        },
        { onConflict: "key" }
      );
    if (error) return { ok: false, error: String(error.message ?? error) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const loaded = await loadNotificationSettings(deps);
  return { ok: true, loaded, notes: normalized.notes };
}

// ---------------------------------------------------------------------------
// Aplicação de overrides (simulador)
// ---------------------------------------------------------------------------

/**
 * Sobrepõe valores pontuais sobre a configuração lida — usado pelo simulador quando o
 * admin quer *explorar* um cenário sem salvar. Devolve a lista de rótulos do que foi
 * sobreposto, para o relatório poder dizer em voz alta que aquilo não é o que vai
 * ser enviado.
 */
export function applyOverrides(
  base: NotificationSettings,
  overrides: {
    rules?: unknown;
    horizonDays?: number;
    runAtHour?: number;
    newChatCapPerDay?: number;
    perCustomerCapPerDay?: number;
    whatsappEnabled?: boolean;
  }
): { settings: NotificationSettings; applied: string[] } {
  const applied: string[] = [];
  const patch: Record<string, unknown> = {};
  const whatsapp = { ...base.whatsapp };

  if (overrides.rules !== undefined) {
    patch.rules = overrides.rules;
    // Mesmo texto que o painel usa (`describeSettingsOverrides`) de propósito: o
    // admin lê o aviso antes de rodar e o relatório registra o mesmo rótulo depois.
    applied.push("régua de lembretes alterada (não salva)");
  }
  if (overrides.horizonDays !== undefined && overrides.horizonDays !== base.horizonDays) {
    patch.horizonDays = overrides.horizonDays;
    applied.push(`horizonte ${base.horizonDays} → ${overrides.horizonDays} dia(s)`);
  }
  if (overrides.runAtHour !== undefined && overrides.runAtHour !== base.runAtHour) {
    patch.runAtHour = overrides.runAtHour;
    applied.push(`hora de execução ${base.runAtHour}h → ${overrides.runAtHour}h`);
  }
  if (overrides.newChatCapPerDay !== undefined && overrides.newChatCapPerDay !== base.whatsapp.newChatCapPerDay) {
    whatsapp.newChatCapPerDay = overrides.newChatCapPerDay;
    applied.push(`cota de novas conversas ${base.whatsapp.newChatCapPerDay} → ${overrides.newChatCapPerDay}`);
  }
  if (overrides.perCustomerCapPerDay !== undefined && overrides.perCustomerCapPerDay !== base.whatsapp.perCustomerCapPerDay) {
    whatsapp.perCustomerCapPerDay = overrides.perCustomerCapPerDay;
    applied.push(`avisos por cliente/dia ${base.whatsapp.perCustomerCapPerDay} → ${overrides.perCustomerCapPerDay}`);
  }
  if (overrides.whatsappEnabled !== undefined && overrides.whatsappEnabled !== base.whatsapp.enabled) {
    whatsapp.enabled = overrides.whatsappEnabled;
    applied.push(`canal WhatsApp ${base.whatsapp.enabled ? "ligado → desligado" : "desligado → ligado"}`);
  }

  const normalized = normalizeDocument(patch, base);
  // Templates atravessam o override: a rodada de simulação usa o MESMO texto salvo,
  // e o fingerprint continua cobrindo os desvios de mensagem após a sobreposição.
  const settings = {
    ...settingsFrom(normalized.document, whatsapp),
    ...(base.templates ? { templates: base.templates } : {}),
  };
  return { settings, applied };
}
