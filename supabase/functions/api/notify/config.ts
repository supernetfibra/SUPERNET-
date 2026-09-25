/**
 * Configuração da integração WhatsApp.
 *
 * Mesma precedência do MikWeb (`getMikWebConfig`): **secrets de ambiente ganham**,
 * a tabela `whatsapp_config` é o fallback editável pelo painel admin. Assim a
 * produção pode ser fixada por secret (imutável pela UI) e o ambiente de testes
 * pode ser configurado pelo painel sem deploy.
 *
 * Dependências injetadas (nada de `Deno.env` aqui) para o módulo seguir
 * typecheckável fora do Deno.
 */

import type { SupabaseLike } from "./outbox.ts";

export interface WhatsAppConfig {
  baseUrl: string;
  adminToken: string;
  instanceToken: string;
  instanceName: string | null;
  enabled: boolean;
  dailyNewChatCap: number;
  perCustomerCap: number;
  windowStart: number;
  windowEnd: number;
  pausedUntil: number | null;
  lastStatus: string | null;
  lastStatusAt: number | null;
  /** De onde vieram as credenciais — aparece no painel. */
  origin: "env" | "db" | "none";
  updatedAt: number;
}

export interface ConfigDeps {
  db: () => SupabaseLike;
  getEnv: (name: string, fallback?: string) => string;
  now?: () => number;
}

export const EMPTY_WHATSAPP_CONFIG: WhatsAppConfig = {
  baseUrl: "",
  adminToken: "",
  instanceToken: "",
  instanceName: null,
  enabled: false,
  dailyNewChatCap: 20,
  perCustomerCap: 1,
  windowStart: 9,
  windowEnd: 20,
  pausedUntil: null,
  lastStatus: null,
  lastStatusAt: null,
  origin: "none",
  updatedAt: 0,
};

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export async function getWhatsAppConfig(deps: ConfigDeps): Promise<WhatsAppConfig> {
  const envUrl = deps.getEnv("UAZAPI_BASE_URL").replace(/\/+$/, "");
  const envInstanceToken = deps.getEnv("UAZAPI_INSTANCE_TOKEN");
  const envAdminToken = deps.getEnv("UAZAPI_ADMIN_TOKEN");

  let row: Record<string, unknown> | null = null;
  try {
    const { data } = await deps.db().from("whatsapp_config").select("*").eq("key", "default").maybeSingle();
    row = (data ?? null) as Record<string, unknown> | null;
  } catch {
    // tabela pode não existir ainda (migration 003 não aplicada)
  }

  const dbUrl = String(row?.base_url ?? "").replace(/\/+$/, "");
  const dbInstanceToken = String(row?.instance_token ?? "");
  const dbAdminToken = String(row?.admin_token ?? "");

  const baseUrl = envUrl || dbUrl;
  const instanceToken = envInstanceToken || dbInstanceToken;

  let origin: WhatsAppConfig["origin"] = "none";
  if (envUrl && envInstanceToken) origin = "env";
  else if (dbUrl && dbInstanceToken) origin = "db";

  return {
    baseUrl,
    adminToken: envAdminToken || dbAdminToken,
    instanceToken,
    instanceName: row?.instance_name === null || row?.instance_name === undefined ? null : String(row.instance_name),
    // Sem URL e token não há como ligar o canal, mesmo que `enabled` esteja true no banco.
    enabled: origin !== "none" && row?.enabled === true,
    dailyNewChatCap: toInt(row?.daily_new_chat_cap, 20),
    perCustomerCap: Math.max(toInt(row?.per_customer_cap, 1), 1),
    windowStart: Math.min(Math.max(toInt(row?.window_start, 9), 0), 23),
    windowEnd: Math.min(Math.max(toInt(row?.window_end, 20), 0), 24),
    pausedUntil: row?.paused_until === null || row?.paused_until === undefined ? null : Number(row.paused_until),
    lastStatus: row?.last_status === null || row?.last_status === undefined ? null : String(row.last_status),
    lastStatusAt: row?.last_status_at === null || row?.last_status_at === undefined ? null : Number(row.last_status_at),
    origin,
    updatedAt: toInt(row?.updated_at, 0),
  };
}

export interface ConfigSaveInput {
  baseUrl?: string;
  adminToken?: string;
  instanceToken?: string;
  instanceName?: string;
  enabled?: boolean;
  dailyNewChatCap?: number;
  perCustomerCap?: number;
  windowStart?: number;
  windowEnd?: number;
}

/** Grava na tabela. Nunca sobrescreve um token com string vazia vinda da UI. */
export async function saveWhatsAppConfig(
  deps: ConfigDeps,
  input: ConfigSaveInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = deps.now?.() ?? Date.now();
  const patch: Record<string, unknown> = { key: "default", updated_at: now, updated_by: "admin" };

  if (input.baseUrl !== undefined) patch.base_url = input.baseUrl.replace(/\/+$/, "");
  if (input.adminToken) patch.admin_token = input.adminToken;
  if (input.instanceToken) patch.instance_token = input.instanceToken;
  if (input.instanceName !== undefined) patch.instance_name = input.instanceName;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.dailyNewChatCap !== undefined) patch.daily_new_chat_cap = Math.max(0, Math.trunc(input.dailyNewChatCap));
  if (input.perCustomerCap !== undefined) patch.per_customer_cap = Math.max(1, Math.trunc(input.perCustomerCap));
  if (input.windowStart !== undefined) patch.window_start = Math.min(Math.max(Math.trunc(input.windowStart), 0), 23);
  if (input.windowEnd !== undefined) patch.window_end = Math.min(Math.max(Math.trunc(input.windowEnd), 1), 24);

  const { error } = await deps.db().from("whatsapp_config").upsert(patch, { onConflict: "key" });
  if (error) return { ok: false, error: String(error.message ?? error) };
  return { ok: true };
}

export async function setWhatsAppPausedUntil(deps: ConfigDeps, pausedUntil: number | null): Promise<void> {
  await deps
    .db()
    .from("whatsapp_config")
    .update({ paused_until: pausedUntil, updated_at: deps.now?.() ?? Date.now() })
    .eq("key", "default");
}

export async function setWhatsAppStatus(deps: ConfigDeps, status: string): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  await deps
    .db()
    .from("whatsapp_config")
    .update({ last_status: status, last_status_at: now, updated_at: now })
    .eq("key", "default");
}

/** Mascara um token para exibição: `ab12...ef90`. Nunca devolve o valor completo. */
export function maskToken(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "•".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
