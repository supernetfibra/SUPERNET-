/**
 * Programa de indicação — chamadas de API e types compartilhados.
 *
 * Os types espelham o payload de `/referrals/me` (buildReferralMeView no
 * backend). Chamadas do cliente usam `fetch` simples (o backend lê a sessão
 * do header `x-session-token`, mesma técnica de authFetch) e as admin levam
 * o token via `?token=` (padrão das páginas admin).
 */

import { apiUrl, authFetch } from "./api-config";

// ---------------------------------------------------------------------------
// Admin fetch (mesma convenção das demais páginas admin — token em localStorage)
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const url = new URL(apiUrl(path), window.location.origin);
  if (token) url.searchParams.set("token", token);
  return fetch(url.toString(), { ...init, credentials: "include" });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RedemptionStatus = "pending" | "approved" | "rejected" | "applied";

export interface ReferralReferralItem {
  name: string;
  status: "pending" | "approved" | "rejected";
  pointsEarned: number;
  createdAt: number;
}

export interface ReferralRedemptionItem {
  id: string;
  title: string;
  pointsCost: number;
  status: RedemptionStatus;
  createdAt: number;
}

export interface ReferralMeView {
  code: string | null;
  shareLink: string | null;
  shareText: string | null;
  balance: number;
  totalEarned: number;
  referrals: ReferralReferralItem[];
  redemptions: ReferralRedemptionItem[];
  pointsPerApproved: number;
}

export interface ReferralReward {
  id: string;
  title: string;
  description: string | null;
  points_cost: number;
  kind: "desconto" | "bonificacao" | "premiacao";
  active: boolean;
  sort_order: number;
}

export interface ReferralAdminData {
  migrationPending: boolean;
  referrals: Array<{
    id: string;
    full_name: string;
    cpf: string;
    phone?: string;
    status: "pending" | "approved" | "rejected";
    referral_code: string;
    referrer_name: string;
    referrer_customer_ref: string | null;
    created_at: number;
    reviewed_at: number | null;
  }>;
  rewards: ReferralReward[];
  redemptions: Array<{
    id: string;
    created_at: number;
    customer_ref: string;
    customer_name: string | null;
    reward_title: string;
    points_cost: number;
    status: RedemptionStatus;
    admin_note: string | null;
    reviewed_at: number | null;
    applied_at: number | null;
  }>;
  ledger: Array<{
    id: number;
    created_at: number;
    customer_ref: string;
    delta: number;
    reason: string;
    source_type: string;
    source_id: string | null;
  }>;
  stats: {
    totalReferrals: number;
    pendingReferrals: number;
    approvedReferrals: number;
    rejectedReferrals: number;
    pointsIssued: number;
    pointsSpent: number;
    redemptionsPending: number;
    activeCustomers: number;
  };
  config: { enabled: boolean; pointsPerApproved: number };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export async function fetchMyReferrals(): Promise<
  { ok: true; data: ReferralMeView } | { ok: false; error: string; migrationPending?: boolean }
> {
  try {
    const res = await authFetch("/api/referrals/me");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao carregar indicações." };
    if (data.migrationPending) return { ok: false, error: "Programa ainda não configurado.", migrationPending: true };
    return { ok: true, data: data.referral as ReferralMeView };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function fetchCatalog(): Promise<{ ok: true; rewards: ReferralReward[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl("/api/public/referral-catalog"));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao carregar o catálogo." };
    return { ok: true, rewards: (data.rewards ?? []) as ReferralReward[] };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function redeemReward(
  rewardId: string
): Promise<{ ok: true; balance: number; duplicate?: boolean } | { ok: false; error: string }> {
  try {
    const res = await authFetch("/api/referrals/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao resgatar." };
    return { ok: true, balance: data.balance, duplicate: data.duplicate };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function fetchAdminReferrals(): Promise<
  { ok: true; data: ReferralAdminData } | { ok: false; error: string; migrationPending?: boolean }
> {
  try {
    const res = await adminFetch("/api/admin/referrals");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao carregar indicações." };
    return { ok: true, data: data as ReferralAdminData };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function saveReferralConfig(payload: { enabled: boolean; pointsPerApproved: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch("/api/admin/referrals/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao salvar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function createReferralReward(payload: {
  title: string;
  description?: string;
  pointsCost: number;
  kind: ReferralReward["kind"];
  sortOrder?: number;
  active?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch("/api/admin/referrals/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao criar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function updateReferralReward(id: string, patch: Partial<ReferralReward>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch(`/api/admin/referrals/rewards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: patch.title,
        description: patch.description,
        pointsCost: patch.points_cost,
        kind: patch.kind,
        active: patch.active,
        sortOrder: patch.sort_order,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao salvar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function deactivateReferralReward(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch(`/api/admin/referrals/rewards/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao desativar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function decideRedemption(
  id: string,
  decision: "approved" | "rejected" | "applied",
  adminNote?: string
): Promise<{ ok: boolean; error?: string; refunded?: boolean }> {
  try {
    const res = await adminFetch(`/api/admin/referrals/redemptions/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, adminNote }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao processar." };
    return { ok: true, refunded: data.refunded };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}

export async function adjustPoints(payload: { customerRef: string; delta: number; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch("/api/admin/referrals/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Erro ao ajustar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha de conexão." };
  }
}
