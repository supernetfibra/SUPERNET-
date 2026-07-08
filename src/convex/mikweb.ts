/**
 * MikWeb API Integration Service
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
// Types
// ---------------------------------------------------------------------------

export interface MikWebCustomer {
  id: string;
  nome: string;
  cpf_cnpj: string;
  email?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  contato?: string;
  contatos?: MikWebContact[];
  telefone?: string;
  celular?: string;
  status?: string;
  planos?: string[];
}

export interface MikWebContact {
  id: string;
  nome?: string;
  telefone: string;
  celular?: string;
  email?: string;
  tipo?: string;
  principal?: boolean;
}

export interface MikWebBilling {
  id: string;
  cliente_id: string;
  competencia: string;
  vencimento: string;
  valor: number;
  status: "pendente" | "pago" | "vencido" | "cancelado";
  linha_digitavel?: string;
  codigo_barras?: string;
  pix_copiaecola?: string;
  url_boleto?: string;
  multa?: number;
  juros?: number;
  desconto?: number;
  data_pagamento?: string;
  valor_pago?: number;
  nosso_numero?: string;
  observacoes?: string;
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

  return response.json();
}

async function apiPost<T>(ctx: ActionCtx, path: string, body?: unknown): Promise<T> {
  const { baseUrl, token } = await getApiConfig(ctx);
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `MikWeb API error (${response.status}): ${errorBody || response.statusText}`
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Customer Services
// ---------------------------------------------------------------------------

export const findCustomerByCPF = action({
  args: { cpf: v.string() },
  handler: async (ctx, args): Promise<MikWebCustomer[]> => {
    const cpf = args.cpf.replace(/\D/g, "");
    const customers = await apiGet<MikWebCustomer[]>(
      ctx,
      `/api/clientes?cpf_cnpj=${cpf}`
    );

    if (!customers || customers.length === 0) {
      throw new Error("Cliente não encontrado com o CPF informado.");
    }

    return customers;
  },
});

export const getCustomerContacts = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<MikWebContact[]> => {
    const contacts = await apiGet<MikWebContact[]>(
      ctx,
      `/api/clientes/${args.customerId}/contatos`
    );
    return contacts || [];
  },
});

export const validateInitialPassword = action({
  args: {
    customerId: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean; contactId?: string }> => {
    const normalizedPassword = args.password.replace(/\D/g, "");

    const contacts = await apiGet<MikWebContact[]>(
      ctx,
      `/api/clientes/${args.customerId}/contatos`
    );

    const matchingContact = contacts?.find((contact) => {
      const contactPhone = (contact.telefone || contact.celular || "").replace(/\D/g, "");
      return contactPhone === normalizedPassword;
    });

    if (matchingContact) {
      return { valid: true, contactId: matchingContact.id };
    }

    const customer = await apiGet<MikWebCustomer>(
      ctx,
      `/api/clientes/${args.customerId}`
    );
    const customerPhone = (customer.telefone || customer.celular || "").replace(/\D/g, "");

    if (customerPhone === normalizedPassword) {
      return { valid: true, contactId: undefined };
    }

    return { valid: false };
  },
});

// ---------------------------------------------------------------------------
// Billing Services
// ---------------------------------------------------------------------------

export const listBillingsByCustomerId = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<MikWebBilling[]> => {
    const billings = await apiGet<MikWebBilling[]>(
      ctx,
      `/api/clientes/${args.customerId}/cobrancas`
    );
    return billings || [];
  },
});

export const getBillingById = action({
  args: { billingId: v.string() },
  handler: async (ctx, args): Promise<MikWebBilling> => {
    return apiGet<MikWebBilling>(ctx, `/api/cobrancas/${args.billingId}`);
  },
});

export const downloadBillingPdf = action({
  args: { billingId: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const billing = await apiGet<MikWebBilling>(
      ctx,
      `/api/cobrancas/${args.billingId}`
    );

    if (!billing.url_boleto) {
      throw new Error("Boleto não disponível para esta cobrança.");
    }

    return { url: billing.url_boleto };
  },
});

export const getCustomerById = action({
  args: { customerId: v.string() },
  handler: async (ctx, args): Promise<MikWebCustomer> => {
    return apiGet<MikWebCustomer>(ctx, `/api/clientes/${args.customerId}`);
  },
});
