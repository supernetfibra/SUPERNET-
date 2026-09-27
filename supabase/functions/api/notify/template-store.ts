/**
 * Persistência dos TEMPLATES de mensagem (WhatsApp e push).
 *
 * Antes deste módulo, o texto que o cliente recebia era constante de código
 * (`DEFAULT_TEMPLATES`): mudar uma vírgula exigia deploy, e o simulador mostrava
 * sempre o mesmo texto. Aqui os templates passam a ser configuração — moram na MESMA
 * linha `notification_config` (key `default`) que a régua, em uma chave separada, com
 * o mesmo padrão dos demais módulos de store: o painel escreve, o dispatcher e o
 * simulador leem a mesma linha, e o que é simulado é o que sai.
 *
 * `templates = {}` significa "nada salvo ainda": o código usa `DEFAULT_TEMPLATES`.
 * O painel mostra a procedência (`db`/`defaults`) e o fingerprint cobre os templates
 * salvos, então "o que foi simulado" e "o que será enviado" continuam comparáveis.
 *
 * Dependências injetadas: roda fora do Deno em teste.
 */

import type { SupabaseLike } from "./outbox.ts";
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  buildPayload,
  type ChannelTemplate,
  type TemplatePayload,
} from "./templates.ts";
import { SETTINGS_TABLE, SETTINGS_KEY } from "./settings.ts";

/** Chave dentro do documento `settings` da linha onde os templates moram. */
export const TEMPLATES_DOC_KEY = "templates";

/** Canais com template editável (o teste usa um próprio, fora deste contrato). */
export const TEMPLATE_CHANNELS = ["whatsapp", "push"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

/** Eventos que a régua pode gerar — um template por evento/canal. */
export const TEMPLATE_EVENT_KEYS = ["billing.due_soon", "billing.due_today", "billing.late"] as const;
export type TemplateEventKey = (typeof TEMPLATE_EVENT_KEYS)[number];

const TITLE_MAX = 120;
const BODY_MAX = 4096;

export interface StoredTemplate {
  body: string;
  /** Só o push usa (o SW renderiza `data.title`). */
  title?: string;
  active: boolean;
}

export interface TemplatesDoc {
  templates: Record<string, StoredTemplate>;
}

export function templatesDocKey(channel: string, eventKey: string): string {
  return `${channel}:${eventKey}`;
}

/**
 * Templates efetivos: os salvos sobrepõem os do código, um a um. Um template salvo
 * com `active: false` desliga aquele evento/canal (o `renderFor` devolve null e o
 * envio registra "sem template ativo").
 */
export function effectiveTemplates(stored: Record<string, StoredTemplate>): ChannelTemplate[] {
  const out: ChannelTemplate[] = DEFAULT_TEMPLATES.map((template) => ({ ...template }));
  for (const template of out) {
    const override = stored[templatesDocKey(template.channel, template.eventKey)];
    if (!override) continue;
    template.body = override.body;
    template.title = override.title ?? undefined;
    template.active = override.active;
  }
  // A lista efetiva é a configuração COMPLETA em vigor, inclusive pares DESLIGADOS:
  // `renderFor` ignora inativos (aí o envio responde "sem template ativo"), e o
  // fingerprint precisa enxergar o desligamento como desvio do padrão. O `test`
  // nunca é editável — sanitizeTemplates rejeita overrides para ele.
  return out;
}

export interface NormalizedTemplates {
  doc: Record<string, StoredTemplate>;
  notes: string[];
}

/**
 * Entrada externa → documento persistível. Parcial por design: só os pares
 * `canal:evento` presentes no corpo são alterados; o resto preserva o que já estava.
 */
export function sanitizeTemplates(raw: unknown, notes: string[], context: string): NormalizedTemplates {
  const out: Record<string, StoredTemplate> = {};
  if (raw === undefined || raw === null) return { doc: out, notes };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    notes.push(`${context}: \`templates\` não é um objeto — templates em vigor mantidos`);
    return { doc: out, notes };
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const [channel, ...eventParts] = key.split(":");
    const eventKey = eventParts.join(":");
    if (
      !TEMPLATE_CHANNELS.includes(channel as TemplateChannel) ||
      !TEMPLATE_EVENT_KEYS.includes(eventKey as TemplateEventKey)
    ) {
      notes.push(`${context}: template "${key}" descartado — canal/evento desconhecido`);
      continue;
    }
    if (typeof value !== "object" || value === null) {
      notes.push(`${context}: template "${key}" descartado — conteúdo inválido`);
      continue;
    }
    const record = value as Record<string, unknown>;
    const body = typeof record.body === "string" ? record.body : "";
    if (!body.trim()) {
      notes.push(`${context}: template "${key}" descartado — corpo vazio`);
      continue;
    }
    const titleRaw = typeof record.title === "string" ? record.title.trim() : "";
    const active = typeof record.active === "boolean" ? record.active : true;
    const template: StoredTemplate = {
      body: body.slice(0, BODY_MAX),
      active,
    };
    if (titleRaw) template.title = titleRaw.slice(0, TITLE_MAX);
    if (channel === "push" && !titleRaw) {
      notes.push(`${context}: template "${key}" salvo sem título — push sem título usa o texto puro`);
    }
    out[templatesDocKey(channel, eventKey)] = template;
  }

  return { doc: out, notes };
}

export interface TemplateStoreDeps {
  db: () => SupabaseLike;
  now?: () => number;
}

export interface LoadedTemplates {
  /** Overrides persistidos (pode ser vazio = código em vigor). */
  stored: Record<string, StoredTemplate>;
  templates: ChannelTemplate[];
  origin: "db" | "defaults";
  notes: string[];
  updatedAt: number | null;
  updatedBy: string | null;
}

export async function loadTemplates(deps: TemplateStoreDeps): Promise<LoadedTemplates> {
  const notes: string[] = [];
  let stored: Record<string, StoredTemplate> = {};
  let origin: LoadedTemplates["origin"] = "defaults";
  let updatedAt: number | null = null;
  let updatedBy: string | null = null;

  try {
    const { data, error } = await deps
      .db()
      .from(SETTINGS_TABLE)
      .select("settings, updated_at, updated_by")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (!error && data && typeof data.settings === "object" && data.settings !== null) {
      const doc = sanitizeTemplates((data.settings as Record<string, unknown>)[TEMPLATES_DOC_KEY], notes, "templates");
      if (Object.keys(doc.doc).length > 0) {
        stored = doc.doc;
        origin = "db";
        updatedAt = typeof data.updated_at === "number" ? data.updated_at : null;
        updatedBy = typeof data.updated_by === "string" ? data.updated_by : null;
      }
    }
  } catch {
    notes.push("tabela de configuração não pôde ser lida — templates padrão do código em vigor");
  }

  return { stored, templates: effectiveTemplates(stored), origin, notes, updatedAt, updatedBy };
}

export interface SaveTemplatesResult {
  ok: boolean;
  error?: string;
  loaded?: LoadedTemplates;
  notes?: string[];
}

/**
 * Grava um patch parcial: os pares presentes no corpo sobrescrevem (ou incluem), os
 * ausentes preservam o que está salvo. Não apaga override salvo — para voltar ao
 * texto do código, o painel envia o texto padrão de volta (ou `active: false`).
 */
export async function saveTemplates(
  deps: TemplateStoreDeps,
  patch: unknown,
  options: { updatedBy?: string } = {}
): Promise<SaveTemplatesResult> {
  const current = await loadTemplates(deps);
  const incoming = sanitizeTemplates(patch, [], "templates");
  const notes = [...incoming.notes];

  const merged: Record<string, StoredTemplate> = { ...current.stored };
  for (const [key, template] of Object.entries(incoming.doc)) {
    merged[key] = template;
    // Editou e voltou ao texto do código? O override deixa de existir: aí o
    // `origin` volta a refletir a realidade em vez de guardar cópia idêntica.
    const baseline = DEFAULT_TEMPLATES.find((t) => templatesDocKey(t.channel, t.eventKey) === key);
    if (
      baseline &&
      template.body === baseline.body &&
      (template.title ?? "") === (baseline.title ?? "") &&
      template.active === baseline.active
    ) {
      delete merged[key];
    }
  }

  const settingsRow: Record<string, unknown> = {
    key: SETTINGS_KEY,
    settings: { [TEMPLATES_DOC_KEY]: merged } as unknown as Record<string, unknown>,
    updated_at: deps.now?.() ?? Date.now(),
    updated_by: options.updatedBy ?? "admin",
  };

  try {
    // Upsert com merge no servidor: a régua (mesma linha) não pode ser apagada por
    // um save de templates, nem vice-versa. PostgREST não faz merge de JSONB no
    // upsert simples, então o documento completo é recomposto aqui.
    const { data } = await deps
      .db()
      .from(SETTINGS_TABLE)
      .select("settings")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const existingSettings: Record<string, unknown> =
      data && typeof data.settings === "object" && data.settings !== null
        ? { ...(data.settings as Record<string, unknown>) }
        : {};
    existingSettings[TEMPLATES_DOC_KEY] = merged;
    settingsRow.settings = existingSettings;

    const { error } = await deps.db().from(SETTINGS_TABLE).upsert(settingsRow, { onConflict: "key" });
    if (error) return { ok: false, error: String(error.message ?? error) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const loaded = await loadTemplates(deps);
  return { ok: true, loaded, notes };
}

// ---------------------------------------------------------------------------
// Payload de exemplo (editor do painel)
// ---------------------------------------------------------------------------

export interface SampleTemplatePayload {
  nome: string;
  primeiro_nome: string;
  referencia: string;
  valor: string;
  valor_atualizado: string;
  vencimento: string;
  dias_atraso: string;
  dias_para_vencer: string;
  boleto: string;
  pix: string;
  link: string;
  empresa: string;
  tem_encargos: string;
}

/** Dados de exemplo para o preview do editor — todos os placeholders preenchidos. */
export function sampleTemplatePayload(): TemplatePayload {
  return {
    nome: "Maria Souza",
    primeiro_nome: "Maria",
    referencia: "Mensalidade de Acesso à Internet",
    valor: "R$ 99,90",
    valor_atualizado: "R$ 102,35",
    vencimento: "25/09/2026",
    dias_atraso: "5",
    dias_para_vencer: "3",
    boleto: "https://exemplo.com/boleto.pdf",
    pix: "00020126580014BR.GOV.BCB.PIX…",
    link: "https://minhasupernet.com/faturas/123",
    empresa: "MinhaSuperNet",
    tem_encargos: "1",
  };
}

/** Payload de exemplo sem Pix/boleto, para ver como a mensagem encolhe. */
export function minimalTemplatePayload(): TemplatePayload {
  const payload = sampleTemplatePayload();
  delete payload.boleto;
  delete payload.pix;
  delete payload.tem_encargos;
  return payload;
}

export interface TemplatePreview {
  key: string;
  channel: TemplateChannel;
  eventKey: TemplateEventKey;
  /** Texto com o corpo/título salvo (ou o padrão, se ainda não editado). */
  body: string;
  title?: string;
  /** Mensagem renderizada com dados de exemplo, completa (com Pix/boleto). */
  sampleFull: string;
  /** Mensagem renderizada sem Pix/boleto — mostra como as seções opcionais somem. */
  sampleMinimal: string;
  /** Placeholders do template que não existem no payload (erro de digitação). */
  missing: string[];
  edited: boolean;
}

const ALL_KEYS = TEMPLATE_CHANNELS.flatMap((channel) =>
  TEMPLATE_EVENT_KEYS.map((eventKey) => ({ channel, eventKey }))
);

/** Estado completo do editor: texto em vigor + render de exemplo por par. */
export function describeTemplates(stored: Record<string, StoredTemplate>): {
  templates: TemplatePreview[];
  defaults: Record<string, StoredTemplate>;
} {
  const defaults: Record<string, StoredTemplate> = {};
  for (const template of DEFAULT_TEMPLATES) {
    if (template.eventKey === "test") continue;
    defaults[templatesDocKey(template.channel, template.eventKey)] = {
      body: template.body,
      ...(template.title ? { title: template.title } : {}),
      active: template.active,
    };
  }

  const templates = ALL_KEYS.map(({ channel, eventKey }) => {
    const key = templatesDocKey(channel, eventKey);
    const override = stored[key];
    const base = DEFAULT_TEMPLATES.find((t) => t.channel === channel && t.eventKey === eventKey);
    const body = override?.body ?? base?.body ?? "";
    const title = override?.title ?? base?.title;
    const active = override?.active ?? base?.active ?? true;

    const fullRender = renderTemplate(
      { channel, eventKey, name: key, body, ...(title ? { title } : {}), active },
      sampleTemplatePayload()
    );
    const minimalRender = renderTemplate(
      { channel, eventKey, name: key, body, ...(title ? { title } : {}), active },
      minimalTemplatePayload()
    );

    return {
      key,
      channel,
      eventKey,
      body,
      title,
      sampleFull: fullRender.body,
      sampleMinimal: minimalRender.body,
      missing: [...new Set([...fullRender.missing, ...minimalRender.missing])],
      edited: !!override,
    };
  });

  return { templates, defaults };
}
