/**
 * Solicitações de instalação — contrato de dados e normalização.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * O backend responde `select("*")` na tabela `install_requests`
 * (supabase/functions/api/index.ts → GET /admin/install-requests), ou seja o
 * payload é a LINHA DO BANCO em snake_case: `full_name`, `created_at`,
 * `photo_house_front`, `desired_plan`... A tela, porém, lia nomes camelCase.
 * Resultado: nome, endereço, plano, fotos e data chegavam `undefined` e a tela
 * renderizava "Invalid Date" e cards vazios.
 *
 * A normalização acontece AQUI, em um único ponto, para que a UI nunca precise
 * de fallback `raw.camelCase ?? raw.snake_case` espalhado pelo JSX. O tipo
 * `InstallRequest` é o contrato camelCase que a tela consome.
 *
 * Fonte do contrato (migrations 001_initial_schema.sql + 002_add_install_request_photos.sql):
 *   id, full_name, cpf, phone, email, zip_code, street, number, complement,
 *   neighborhood, city, state, desired_plan, message, agreed_to_terms, status,
 *   admin_note, reviewed_at, ip_address, created_at,
 *   photo_house_front, photo_street, photo_id_front, photo_id_back
 * `created_at`/`reviewed_at` são BIGINT (epoch em ms) — não string.
 */

import { adminFetch } from "./api-config";

// ---------------------------------------------------------------------------
// Types (espelham o payload; são o contrato camelCase da tela)
// ---------------------------------------------------------------------------

export type InstallStatus = "pending" | "approved" | "rejected";

export interface InstallRequest {
  id: string;
  fullName: string;
  cpf: string;
  phone: string;
  email?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  desiredPlan?: string | null;
  message?: string | null;
  agreedToTerms?: boolean;
  status: InstallStatus;
  adminNote?: string | null;
  /**
   * Código de indicação (coluna `referral_code`, migration 011). Quando presente,
   * a aprovação credita pontos ao indicador no banco — por isso o diálogo de
   * decisão mostra o código.
   */
  referralCode?: string | null;
  /** Epoch em ms (BIGINT no banco). */
  createdAt: number;
  /** Epoch em ms; ausente enquanto a solicitação não foi revisada. */
  reviewedAt?: number | null;
  ipAddress?: string | null;
  photoHouseFront?: string | null;
  photoStreet?: string | null;
  photoIdFront?: string | null;
  photoIdBack?: string | null;
}

export interface InstallSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

/** Linha crua do banco (snake_case) — o que o endpoint devolve de fato. */
interface InstallRequestRow {
  id?: string;
  full_name?: string | null;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  zip_code?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  desired_plan?: string | null;
  message?: string | null;
  agreed_to_terms?: boolean | null;
  status?: string | null;
  admin_note?: string | null;
  referral_code?: string | null;
  created_at?: number | string | null;
  reviewed_at?: number | string | null;
  ip_address?: string | null;
  photo_house_front?: string | null;
  photo_street?: string | null;
  photo_id_front?: string | null;
  photo_id_back?: string | null;
}

/**
 * BIGINT do Postgres chega como number (JSON) — mas emorphic numbers grandes
 * podem vir string. Converte para epoch ms; devolve undefined se ausente/inválido.
 */
function toEpochMs(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** snake_case do banco → camelCase da tela. Único ponto de normalização. */
export function normalizeInstallRequest(row: InstallRequestRow): InstallRequest {
  return {
    id: row.id ?? "",
    fullName: row.full_name ?? "",
    cpf: row.cpf ?? "",
    phone: row.phone ?? "",
    email: row.email ?? null,
    zipCode: row.zip_code ?? null,
    street: row.street ?? null,
    number: row.number ?? null,
    complement: row.complement ?? null,
    neighborhood: row.neighborhood ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    desiredPlan: row.desired_plan ?? null,
    message: row.message ?? null,
    agreedToTerms: row.agreed_to_terms ?? false,
    status: (row.status as InstallStatus) ?? "pending",
    adminNote: row.admin_note ?? null,
    referralCode: row.referral_code ?? null,
    createdAt: toEpochMs(row.created_at) ?? 0,
    reviewedAt: toEpochMs(row.reviewed_at) ?? null,
    ipAddress: row.ip_address ?? null,
    photoHouseFront: row.photo_house_front ?? null,
    photoStreet: row.photo_street ?? null,
    photoIdFront: row.photo_id_front ?? null,
    photoIdBack: row.photo_id_back ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface InstallRequestsResult {
  requests: InstallRequest[];
  summary: InstallSummary | null;
}

/** GET /admin/install-requests — já normalizado para o contrato da tela. */
export async function fetchInstallRequests(
  status?: string
): Promise<InstallRequestsResult> {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);

  const res = await adminFetch(
    `/api/admin/install-requests?${params.toString()}`
  );
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);

  const json = await res.json();
  const rows: InstallRequestRow[] = json.requests || [];
  return {
    requests: rows.map(normalizeInstallRequest),
    summary: json.summary ?? null,
  };
}