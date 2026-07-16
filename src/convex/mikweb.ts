/**
 * MikWeb API Integration Service
 *
 * Base URL: https://api.mikweb.com.br/v1/admin/
 * Auth: Bearer Token (Authorization: Bearer <token>)
 *
 * This module provides Convex actions to interact with the MikWeb REST API.
 * API configuration can come from environment variables OR from the
 * mikwebConfig table in the database (set by the admin UI).
 *
 * Priority: env vars > DB config
 *
 * Required env vars (if DB config not set):
 *   MIKWEB_API_URL     - Base URL for the MikWeb API
 *   MIKWEB_API_TOKEN   - Bearer token for API authentication
 */

"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";

// ---------------------------------------------------------------------------
// Types — based on official MikWeb API response format
// ---------------------------------------------------------------------------

export interface MikWebCustomer {
  id: number;
  full_name: string;
  login: string;
  password?: string;
  email?: string;
  cpf_cnpj?: string;
  rg?: string;
  person_type?: string;
  phone_number?: string;
  cell_phone_number_1?: string;
  cell_phone_number_2?: string;
  cell_phone_number_3?: string;
  cell_phone_number_4?: string;
  status: string;
  due_day?: number;
  zip_code?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  server_id?: number;
  plan_id?: number;
  customer_group_id?: number;
  financial_status?: string;
  msg_payment_mk?: string;
  authentication_type?: string;
  ip?: string;
  ip_pppoe?: string;
  mac?: string;
  observation?: string;
  server?: { id: number; name: string; hash_server: string };
  plan?: { id: number; name: string; value: string };
  customer_group?: { id: number; name: string };
}

export interface MikWebBilling {
  id: number;
  customer_id: number;
  value: number;
  value_paid?: number | null;
  date_payment?: string | null;
  situation_id: number;
  situation_name: string;
  reference: string;
  type_billing: string;
  due_day: string;
  observation?: string | null;
  form_payment: string;
  digitable_line?: string;
  integration_link?: string;
  pix_copy_paste_base64?: string;
  pix_qr_code_image_base64?: string;
  lock_in?: string | null;
  customer?: { id: number; full_name: string };
  situation?: { id: number; name: string };
  payment_card_id?: number;
  parcel_number?: number;
  number_billet?: number;
  our_number?: number;
  generated_shipping?: boolean;
  date_shipping?: string;
  type_shipping?: string;
  nf_issued?: boolean;
  nf_issue_date?: string;
}

export interface MikWebApiResponse<T> {
  [key: string]: unknown;
  meta?: {
    pages: {
      current_page: number;
      next_page: number | null;
      prev_page: number | null;
      total_pages: number;
      total_count: number;
    };
  };
}

export interface MikWebApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEnvConfig() {
  const baseUrl = process.env.MIKWEB_API_URL;
  const token = process.env.MIKWEB_API_TOKEN;
  return baseUrl && token ? { baseUrl, token } : null;
}

async function getApiConfig(ctx: ActionCtx) {
  // Priority 1: Environment variables
  const envConfig = getEnvConfig();
  if (envConfig) return envConfig;

  // Priority 2: Database-stored config
  try {
    const dbConfig = await ctx.runQuery(api.admin.getRawApiConfig);
    if (dbConfig) {
      return { baseUrl: dbConfig.apiUrl, token: dbConfig.apiToken };
    }
  } catch {
    // Ignore errors reading DB config
  }

  throw new Error(
    "MikWeb API não configurada. Configure a URL e o Token da API no painel de administração " +
    "ou defina as variáveis de ambiente MIKWEB_API_URL e MIKWEB_API_TOKEN."
  );
}

async function apiGet<T>(ctx: ActionCtx, path: string): Promise<T> {
  const { baseUrl, token } = await getApiConfig(ctx);
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `MikWeb API error (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const data: Record<string, unknown> = await response.json();

  // The API wraps results in { "customer": {...} } or { "customers": [...], "meta": {...} }
  // or { "billing": {...} } or { "billings": [...], "meta": {...} }
  // Extract the first key's value as the result (skip "meta")
  const keys = Object.keys(data).filter((k) => k !== "meta");
  if (keys.length === 1) {
    return data[keys[0]] as T;
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Customer Services
// ---------------------------------------------------------------------------

/**
 * Find customers by CPF/CNPJ.
 * API endpoint: GET /customers?search=<cpf>
 * Response: { "customers": [...], "meta": {...} }
 */
export const findCustomerByCPF = action({
  args: { cpf: v.string() },
  handler: async (ctx, args): Promise<MikWebCustomer[]> => {
    const cpf = args.cpf.replace(/\D/g, "");
    const customers = await apiGet<MikWebCustomer[]>(
      ctx,
      `/customers?search=${cpf}`
    );

    if (!customers || customers.length === 0) {
      throw new Error("Cliente não encontrado com o CPF informado.");
    }

    return customers;
  },
});

/**
 * Get a single customer by ID.
 * API endpoint: GET /customers/<ID>
 * Response: { "customer": {...} }
 */
export const getCustomerById = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<MikWebCustomer> => {
    return apiGet<MikWebCustomer>(ctx, `/customers/${args.customerId}`);
  },
});

/**
 * Validate the initial password (last 4 digits of CPF).
 * The user's initial password is the last 4 digits of their CPF/CNPJ.
 */
export const validateInitialPassword = action({
  args: {
    customerId: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const normalizedPassword = args.password.replace(/\D/g, "");

    const customer = await apiGet<MikWebCustomer>(
      ctx,
      `/customers/${args.customerId}`
    );

    // Extract the last 4 digits of the customer's CPF/CNPJ
    const cpfDigits = (customer.cpf_cnpj || "").replace(/\D/g, "");
    const last4Cpf = cpfDigits.slice(-4);

    if (last4Cpf && normalizedPassword === last4Cpf) {
      return { valid: true };
    }

    return { valid: false };
  },
});

// ---------------------------------------------------------------------------
// Billing Services
// ---------------------------------------------------------------------------

/**
 * List billings by customer ID.
 * API endpoint: GET /billings?customer_id=<ID>
 * Response: { "billings": [...], "meta": {...} }
 */
export const listBillingsByCustomerId = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<MikWebBilling[]> => {
    const billings = await apiGet<MikWebBilling[]>(
      ctx,
      `/billings?customer_id=${args.customerId}`
    );
    return billings || [];
  },
});

/**
 * Get a single billing by ID.
 * API endpoint: GET /billings/<ID>
 * Response: { "billing": {...} }
 */
export const getBillingById = action({
  args: { billingId: v.string() },
  handler: async (ctx, args): Promise<MikWebBilling> => {
    return apiGet<MikWebBilling>(ctx, `/billings/${args.billingId}`);
  },
});

/**
 * Get the PDF download URL for a billing.
 * API endpoint: GET /billings/<ID>/download?valid=true
 * Returns a PDF file. We return the download URL instead.
 */
export const downloadBillingPdf = action({
  args: { billingId: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const { baseUrl, token } = await getApiConfig(ctx);
    const url = `${baseUrl.replace(/\/$/, "")}/billings/${args.billingId}/download?valid=true`;

    // Verify the download endpoint is accessible
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Boleto não disponível (HTTP ${response.status}). Verifique se a cobrança possui forma de emissão com boleto registrado.`
      );
    }

    return { url };
  },
});

/**
 * Get previous phone numbers/contacts from a customer.
 * The MikWeb API doesn't have a separate contacts endpoint.
 * We extract all phone fields from the customer record.
 */
export const getCustomerContacts = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<Array<{ id: string; phone: string; label?: string }>> => {
    const customer = await apiGet<MikWebCustomer>(
      ctx,
      `/customers/${args.customerId}`
    );

    const contacts: Array<{ id: string; phone: string; label?: string }> = [];

    if (customer.phone_number) {
      contacts.push({
        id: `${customer.id}-phone`,
        phone: customer.phone_number,
        label: "Telefone",
      });
    }

    const cellFields = ["cell_phone_number_1", "cell_phone_number_2", "cell_phone_number_3", "cell_phone_number_4"] as const;

    for (const key of cellFields) {
      const phone = customer[key];
      if (typeof phone === "string" && phone) {
        contacts.push({
          id: `${customer.id}-${key}`,
          phone: phone,
          label: key === "cell_phone_number_1" ? "Celular 1" : key === "cell_phone_number_2" ? "Celular 2" : key === "cell_phone_number_3" ? "Celular 3" : "Celular 4",
        });
      }
    }

    return contacts;
  },
});
