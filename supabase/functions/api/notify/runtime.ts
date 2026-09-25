/**
 * Raiz de composição do canal WhatsApp.
 *
 * Junta as peças (config, outbox, adapter, dispatcher, caso de uso de envio) e
 * devolve o que as rotas precisam. Fica aqui — e não no `index.ts` — porque assim
 * o "encanamento" é typecheckado: `index.ts` tem imports de `esm.sh` e não entra
 * em nenhum tsconfig, então tudo que é lógica de verdade mora do lado de cá.
 *
 * Todas as dependências externas entram por injeção (`db`, `getEnv`), então este
 * arquivo roda fora do Deno em teste.
 */

import { createOutbox, type OutboxApi, type SupabaseLike } from "./outbox.ts";
import { createChannelRegistry, type ChannelAdapter, type ChannelRegistry } from "./channel.ts";
import { createWhatsAppAdapter } from "./channels/whatsapp.ts";
import {
  loadNotificationSettings,
  saveNotificationSettings,
  type LoadedSettings,
  type SaveSettingsResult,
} from "./settings-store.ts";
import {
  getWhatsAppConfig,
  saveWhatsAppConfig,
  setWhatsAppPausedUntil,
  setWhatsAppStatus,
  type ConfigSaveInput,
  type WhatsAppConfig,
} from "./config.ts";
import { dispatchQueue, type DispatchOptions, type DispatchSummary } from "./dispatch.ts";
import { runBillingSync, type SyncBaseLoader, type SyncOptions, type SyncSummary } from "./sync.ts";
import { sendBillingReminder, type BillingContact, type SendBillingInput, type SendBillingResult, type SaveContactInput } from "./send-billing.ts";
import type { ChannelTemplate } from "./templates.ts";

export interface RuntimeDeps {
  db: () => SupabaseLike;
  getEnv: (name: string, fallback?: string) => string;
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  templates?: ChannelTemplate[];
  portalBaseUrl?: string;
  companyName?: string;
}

export interface WhatsAppRuntime {
  getConfig(): Promise<WhatsAppConfig>;
  saveConfig(input: ConfigSaveInput): Promise<{ ok: boolean; error?: string }>;
  /**
   * Configuração efetiva do pipeline (régua + canal), a mesma que o simulador lê.
   * O dispatcher e o envio sob demanda consomem daqui — não de constantes do código.
   */
  getSettings(): Promise<LoadedSettings>;
  saveSettings(input: unknown, options?: { updatedBy?: string }): Promise<SaveSettingsResult>;
  getContact(customerId: string): Promise<BillingContact | null>;
  saveContact(input: SaveContactInput): Promise<void>;
  setStatus(status: string): Promise<void>;
  setPausedUntil(until: number | null): Promise<void>;
  outbox: OutboxApi;
  registry: ChannelRegistry;
  adapter: ChannelAdapter;
  dispatch(options?: DispatchOptions): Promise<DispatchSummary>;
  sendBilling(input: SendBillingInput): Promise<SendBillingResult>;
  /**
   * Estágio de sync: enfileira os avisos do dia a partir da base real.
   *
   * O carregador entra por parâmetro porque as credenciais da MikWeb vivem no
   * `index.ts` (`getMikWebConfig`/`mikwebApiGetFull`) — este módulo não as alcança sem
   * criar import circular. As settings, essas sim, vêm daqui: a régua que enfileira é a
   * mesma que o simulador mostrou.
   */
  sync(options: SyncOptions & { loadBase: SyncBaseLoader }): Promise<SyncSummary>;
}

export function createWhatsAppRuntime(deps: RuntimeDeps): WhatsAppRuntime {
  const outbox = createOutbox(deps.db);
  const configDeps = { db: deps.db, getEnv: deps.getEnv, now: deps.now };

  const getConfig = () => getWhatsAppConfig(configDeps);

  // O canal é lido pelo `getWhatsAppConfig` (um leitor por tabela) e a régua por
  // `loadNotificationSettings`; as duas metades formam a configuração efetiva.
  const settingsDeps = { db: deps.db, getChannelConfig: getConfig, now: deps.now };
  const getSettings = () => loadNotificationSettings(settingsDeps);

  const adapter = createWhatsAppAdapter({
    getConfig,
    outbox,
    setPausedUntil: (until) => setWhatsAppPausedUntil(configDeps, until),
    now: deps.now,
  });

  const registry = createChannelRegistry([adapter]);

  const dispatch = (options: DispatchOptions = {}) =>
    dispatchQueue(
      {
        outbox,
        registry,
        templates: deps.templates,
        now: deps.now,
        log: deps.log,
        perCustomerCap: async () => (await getSettings()).settings.whatsapp.perCustomerCapPerDay,
        // A cota de novas conversas é a MESMA que o simulador projeta
        // (`newChatCapPerDay`): sem isto, o relatório prometia um teto que o envio
        // não aplicava e o estouro só aparecia como time-lock do WhatsApp.
        newChatCap: async (channel) =>
          channel === "whatsapp" ? (await getSettings()).settings.whatsapp.newChatCapPerDay : null,
        window: async (channel) => {
          if (channel !== "whatsapp") return null;
          const { settings } = await getSettings();
          return { start: settings.whatsapp.windowStart, end: settings.whatsapp.windowEnd };
        },
      },
      options
    );

  async function getContact(customerId: string): Promise<BillingContact | null> {
    if (!customerId) return null;
    try {
      const { data, error } = await deps
        .db()
        .from("whatsapp_contacts")
        .select("phone_e164, opt_in, opt_out_at, customer_name")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      return {
        phoneE164: row.phone_e164 === null || row.phone_e164 === undefined ? null : String(row.phone_e164),
        // `opt_out_at` vence o opt-in: quem pediu PARAR não volta a receber por engano.
        optIn: row.opt_in === true && !row.opt_out_at,
        customerName: row.customer_name === null || row.customer_name === undefined ? null : String(row.customer_name),
      };
    } catch {
      // tabela ainda não existe (migration 003 pendente) — trata como sem contato
      return null;
    }
  }

  async function saveContact(input: SaveContactInput): Promise<void> {
    const now = deps.now?.() ?? Date.now();
    try {
      await deps.db().from("whatsapp_contacts").upsert(
        {
          customer_id: input.customerId,
          cpf: input.cpf,
          customer_name: input.customerName,
          phone_e164: input.phoneE164,
          opt_in: input.optIn,
          opt_in_at: input.optIn ? now : null,
          source: input.source,
          status: "active",
          updated_at: now,
        },
        { onConflict: "customer_id" }
      );
    } catch (error) {
      deps.log?.("falha ao registrar contato de WhatsApp", { error: String(error) });
    }
  }

  return {
    getConfig,
    saveConfig: (input) => saveWhatsAppConfig(configDeps, input),
    getSettings,
    saveSettings: (input, options) => saveNotificationSettings(settingsDeps, input, options),
    getContact,
    saveContact,
    setStatus: (status) => setWhatsAppStatus(configDeps, status),
    setPausedUntil: (until) => setWhatsAppPausedUntil(configDeps, until),
    outbox,
    registry,
    adapter,
    dispatch,
    sendBilling: async (input) => {
      // Uma leitura só: régua, marca e link do portal saem da MESMA configuração que
      // o simulador mostrou. `RuntimeDeps` continua podendo fixar marca por código
      // (útil em teste), mas o padrão é a configuração persistida.
      const { settings } = await getSettings();
      return sendBillingReminder(
        {
          outbox,
          getContact,
          saveContact,
          dispatch,
          templates: deps.templates,
          now: deps.now,
          portalBaseUrl: deps.portalBaseUrl ?? settings.portalBaseUrl,
          companyName: deps.companyName ?? settings.companyName,
          getRules: async () => settings.rules,
        },
        input
      );
    },
    sync: (options) =>
      runBillingSync(
        {
          outbox,
          getSettings,
          loadBase: options.loadBase,
          templates: deps.templates,
          now: deps.now,
          log: deps.log,
        },
        options
      ),
  };
}
