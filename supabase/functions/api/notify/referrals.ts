/**
 * Módulo puro de indicações ("Indique e Ganhe") — sem I/O, injetado.
 *
 * Segue o padrão do `notify/`: a lógica que decide (geração/validação de
 * código, view models do ledger, estatísticas) mora aqui e é testável em Node
 * (check:notify) sem banco. Sintaxe apenas "erasable" (sem enum/namespace/
 * parameter properties) — os testes rodam os módulos TS por type-stripping.
 */

// ---------------------------------------------------------------------------
// Código de indicação
// ---------------------------------------------------------------------------

/** Alfabeto Crockford: sem I, L, O, U — evita confusão de leitura/letra. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Tamanho do código público (?ref=XXXXXX). 33^8 ≈ 1,4 × 10^12 — folga total. */
export const REFERRAL_CODE_LENGTH = 8;
/** Normalizações aceitas na digitação manual (0↔O, 1↔I/L, sem separadores). */
const CODE_ALIASES: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
  U: "V",
};

export function generateReferralCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Aceita o código com ou sem hífen/espaço, maiúscula/minúscula e erros comuns
 * de leitura (O→0, I/L→1, U→V). Devolve null quando não há código plausível.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cleaned.length !== REFERRAL_CODE_LENGTH) return null;
  let out = "";
  for (const ch of cleaned) {
    out += CODE_ALIASES[ch] ?? ch;
  }
  return /^[0-9A-Z]+$/.test(out) ? out : null;
}

// ---------------------------------------------------------------------------
// View models (o formato que o endpoint devolve ao frontend)
// ---------------------------------------------------------------------------

export interface ReferralLedgerRow {
  created_at: number;
  customer_ref: string;
  delta: number;
  reason: string;
  source_type: string;
  source_id: string | null;
}

export interface ReferralCodeRow {
  code: string;
  customer_ref: string;
  referrer_name: string;
  active: boolean;
}

export interface InstallRequestReferralRow {
  id: string;
  full_name: string;
  cpf: string;
  status: string;
  referral_code: string | null;
  created_at: number;
}

export interface RedemptionRow {
  id: string;
  created_at: number;
  customer_ref: string;
  customer_name: string | null;
  reward_id: string;
  reward_title: string;
  points_cost: number;
  status: "pending" | "approved" | "rejected" | "applied";
  admin_note: string | null;
  reviewed_at: number | null;
  applied_at: number | null;
}

export interface ReferralMeInput {
  codeRow: ReferralCodeRow | null;
  ledger: ReferralLedgerRow[];
  redemptions: RedemptionRow[];
  referrals: InstallRequestReferralRow[];
  /** Nome público de um código consultado publicamente (somente 1º nome). */
  codeOwnerFirstName?: string | null;
}

export interface ReferralMeView {
  code: string | null;
  /** Link completo do portal (portalBaseUrl das configurações) com ?ref=<código>. */
  shareLink: string | null;
  shareText: string | null;
  balance: number;
  totalEarned: number;
  referrals: Array<{
    name: string;
    status: "pending" | "approved" | "rejected";
    pointsEarned: number;
    createdAt: number;
  }>;
  redemptions: Array<{
    id: string;
    title: string;
    pointsCost: number;
    status: RedemptionRow["status"];
    createdAt: number;
  }>;
  pointsPerApproved: number;
}

const REFERRAL_STATUS_TO_POINTS: Record<string, number> = {
  pending: 0,
  approved: 1,
  rejected: 0,
};

export function buildReferralMeView(
  input: ReferralMeInput,
  portalBaseUrl: string,
  companyName: string,
  pointsPerApproved: number,
): ReferralMeView {
  const balance = input.ledger.reduce((acc, row) => acc + row.delta, 0);
  const totalEarned = input.ledger.filter((r) => r.delta > 0).reduce((acc, r) => acc + r.delta, 0);
  const code = input.codeRow?.code ?? null;
  const portal = portalBaseUrl.replace(/\/+$/, "");
  const shareLink = code ? `${portal}/?ref=${code}` : null;
  const shareText = shareLink
    ? `Indique a ${companyName} e ganhe pontos! Acesse: ${shareLink}`
    : null;
  return {
    code,
    shareLink,
    shareText,
    balance,
    totalEarned,
    referrals: input.referrals
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .map((r) => ({
        name: r.full_name,
        status: (r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending") as
          | "pending"
          | "approved"
          | "rejected",
        pointsEarned: Math.round(pointsPerApproved * (REFERRAL_STATUS_TO_POINTS[r.status] ?? 0)),
        createdAt: r.created_at,
      })),
    redemptions: input.redemptions
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .map((r) => ({
        id: r.id,
        title: r.reward_title,
        pointsCost: r.points_cost,
        status: r.status,
        createdAt: r.created_at,
      })),
    pointsPerApproved,
  };
}

/**
 * Nome público para o banner do formulário: SOMENTE o primeiro nome (LGPD).
 * Excesso de nomes curtos ("Dr.") é aceito — é sempre o primeiro token.
 */
export function publicFirstName(referrerName: string | null | undefined): string | null {
  if (!referrerName || typeof referrerName !== "string") return null;
  const first = referrerName.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.length > 40 ? first.slice(0, 40) : first;
}

// ---------------------------------------------------------------------------
// Aviso de aprovação (WhatsApp via outbox — mesma fila dos lembretes)
// ---------------------------------------------------------------------------

/** Evento/template do aviso de aprovação (ver DEFAULT_TEMPLATES). */
export const REFERRAL_APPROVED_EVENT_KEY = "referral.approved";

/**
 * `referral:<solicitacao>:approval` — a MENSAGEM deduplica pela MESMA chave do
 * crédito de pontos: aprovar duas vezes não credita (unique parcial no ledger)
 * e não reenvia (enqueue_notification). Um evento só, duas garantias.
 */
export function referralApprovedDedupeKey(installRequestId: string): string {
  return `referral:${installRequestId}:approval`;
}

/**
 * Payload semântico do aviso. Os placeholders espelham o template default de
 * `referral.approved` (`{{indicado}}`, `{{pontos}}`, `{{saldo}}`, `{{link}}`,
 * `{{primeiro_nome}}`, `{{empresa}}`). `link` aponta para /indicacoes (a página
 * real do portal, ver `src/main.tsx`); `saldo` é o saldo JÁ INCLUINDO o crédito
 * desta aprovação — nunca anunciar um número que o cliente não tem.
 */
export function referralApprovedPayload(input: {
  referrerFirstName: string;
  referredName: string;
  points: number;
  /** Saldo do indicador após o crédito (calcule DEPOIS de creditar). */
  balanceAfter: number;
  portalBaseUrl: string;
  companyName: string;
}): Record<string, string> {
  return {
    nome: input.referrerFirstName,
    primeiro_nome: input.referrerFirstName,
    indicado: input.referredName,
    pontos: String(Math.max(0, Math.round(input.points))),
    saldo: String(Math.max(0, Math.round(input.balanceAfter))),
    link: `${input.portalBaseUrl.replace(/\/+$/, "")}/indicacoes`,
    empresa: input.companyName,
  };
}

// ---------------------------------------------------------------------------
// Estatísticas do painel admin
// ---------------------------------------------------------------------------

/**
 * Máquina de estados do resgate — espelha `referral_redemption_status_allowed`
 * (migration 011). Validada no backend ANTES do UPDATE; a função no banco é a
 * segunda linha de defesa.
 */
export const REDEMPTION_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "rejected"],
  approved: ["applied"],
  rejected: ["approved"], // reverter rejeição (erro do admin)
  applied: [],
};

export function redemptionTransitionAllowed(from: string, to: string): boolean {
  return (REDEMPTION_TRANSITIONS[from] ?? []).includes(to);
}

export const REFERRAL_REWARD_KINDS = ["desconto", "bonificacao", "premiacao"] as const;
export type ReferralRewardKind = (typeof REFERRAL_REWARD_KINDS)[number];

export function isReferralRewardKind(value: unknown): value is ReferralRewardKind {
  return typeof value === "string" && (REFERRAL_REWARD_KINDS as readonly string[]).includes(value);
}

export interface ReferralStatsInput {
  ledger: ReferralLedgerRow[];
  redemptions: RedemptionRow[];
  referrals: InstallRequestReferralRow[];
}

export interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  approvedReferrals: number;
  rejectedReferrals: number;
  pointsIssued: number;
  pointsSpent: number;
  redemptionsPending: number;
  activeCustomers: number;
}

export function referralStats(input: ReferralStatsInput): ReferralStats {
  const approved = input.referrals.filter((r) => r.status === "approved").length;
  const rejected = input.referrals.filter((r) => r.status === "rejected").length;
  const pending = input.referrals.filter((r) => r.status === "pending").length;
  return {
    totalReferrals: input.referrals.length,
    pendingReferrals: pending,
    approvedReferrals: approved,
    rejectedReferrals: rejected,
    pointsIssued: input.ledger.filter((r) => r.delta > 0).reduce((a, r) => a + r.delta, 0),
    pointsSpent: -input.ledger.filter((r) => r.delta < 0).reduce((a, r) => a + r.delta, 0),
    redemptionsPending: input.redemptions.filter((r) => r.status === "pending").length,
    activeCustomers: new Set(input.ledger.map((r) => r.customer_ref)).size,
  };
}
