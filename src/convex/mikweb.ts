/**
 * MikWeb API Integration Service
 *
 * This module provides Convex actions to interact with the MikWeb REST API.
 * Configure the API base URL and token in environment variables.
 *
 * Required env vars:
 *   MIKWEB_API_URL     - Base URL for the MikWeb API (e.g., https://api.mikweb.com.br)
 *   MIKWEB_API_TOKEN   - Bearer token for API authentication
 */

"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

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

function getApiConfig() {
  const baseUrl = process.env.MIKWEB_API_URL;
  const token = process.env.MIKWEB_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error(
      "MikWeb API not configured. Set MIKWEB_API_URL and MIKWEB_API_TOKEN in environment variables."
    );
  }

  return { baseUrl, token };
}

async function apiGet<T>(path: string): Promise<T> {
  const { baseUrl, token } = getApiConfig();
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

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const { baseUrl, token } = getApiConfig();
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

/**
 * Search for a customer by CPF/CNPJ.
 * Returns the customer(s) found or throws if none found.
 */
export const findCustomerByCPF = action({
  args: { cpf: v.string() },
  handler: async (_ctx, args): Promise<MikWebCustomer[]> => {
    const cpf = args.cpf.replace(/\D/g, "");

    // Normal API call — replace with actual MikWeb endpoint
    // The endpoint path depends on the MikWeb API version/contract.
    // Common patterns: /api/clientes/cpf/{cpf} or /api/clientes?cpf={cpf}
    const customers = await apiGet<MikWebCustomer[]>(
      `/api/clientes?cpf_cnpj=${cpf}`
    );

    if (!customers || customers.length === 0) {
      throw new Error("Cliente não encontrado com o CPF informado.");
    }

    return customers;
  },
});

/**
 * Get contacts for a specific customer.
 */
export const getCustomerContacts = action({
  args: { customerId: v.string() },
  handler: async (_ctx, args): Promise<MikWebContact[]> => {
    const contacts = await apiGet<MikWebContact[]>(
      `/api/clientes/${args.customerId}/contatos`
    );

    return contacts || [];
  },
});

/**
 * Validate the user's password (phone number) against customer data.
 * Returns the matching contact if valid, or throws if invalid.
 */
export const validateInitialPassword = action({
  args: {
    customerId: v.string(),
    password: v.string(),
  },
  handler: async (_ctx, args): Promise<{ valid: boolean; contactId?: string }> => {
    const normalizedPassword = args.password.replace(/\D/g, "");

    // Get customer contacts
    const contacts = await apiGet<MikWebContact[]>(
      `/api/clientes/${args.customerId}/contatos`
    );

    // Find a contact whose phone matches the password
    const matchingContact = contacts?.find((contact) => {
      const contactPhone = (contact.telefone || contact.celular || "").replace(/\D/g, "");
      return contactPhone === normalizedPassword;
    });

    if (matchingContact) {
      return { valid: true, contactId: matchingContact.id };
    }

    // Also check the customer's main phone fields
    const customer = await apiGet<MikWebCustomer>(
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

/**
 * List all billings for a customer.
 */
export const listBillingsByCustomerId = action({
  args: { customerId: v.string() },
  handler: async (_ctx, args): Promise<MikWebBilling[]> => {
    const billings = await apiGet<MikWebBilling[]>(
      `/api/clientes/${args.customerId}/cobrancas`
    );
    return billings || [];
  },
});

/**
 * Get a single billing by ID.
 */
export const getBillingById = action({
  args: { billingId: v.string() },
  handler: async (_ctx, args): Promise<MikWebBilling> => {
    return apiGet<MikWebBilling>(`/api/cobrancas/${args.billingId}`);
  },
});

/**
 * Download a billing PDF.
 * Returns the URL to download the PDF from MikWeb.
 */
export const downloadBillingPdf = action({
  args: { billingId: v.string() },
  handler: async (_ctx, args): Promise<{ url: string }> => {
    const billing = await apiGet<MikWebBilling>(
      `/api/cobrancas/${args.billingId}`
    );

    if (!billing.url_boleto) {
      throw new Error("Boleto não disponível para esta cobrança.");
    }

    return { url: billing.url_boleto };
  },
});

/**
 * Get customer details by ID.
 */
export const getCustomerById = action({
  args: { customerId: v.string() },
  handler: async (_ctx, args): Promise<MikWebCustomer> => {
    return apiGet<MikWebCustomer>(`/api/clientes/${args.customerId}`);
  },
});
