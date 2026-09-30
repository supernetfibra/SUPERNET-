/**
 * Métricas do programa de indicações para o card do dashboard.
 *
 * Módulo puro (sem I/O): recebe as linhas já lidas e devolve os números. O
 * corte "do mês" é por calendário civil BRT (UTC-3), mesma convenção de fuso do
 * núcleo (`model.ts`, DEFAULT_TZ_OFFSET_MINUTES = -180) — não por janela móvel
 * de 30 dias, para o número do card bater com o que o admin vê na lista.
 */

/** Fuso civil do projeto (BRT), espelhando model.ts. */
const TZ_OFFSET_MINUTES = -180;

/** Mês civil BRT de um epoch ms: "2026-09". */
export function monthKeyBrt(ms: number): string {
  const shifted = new Date(ms + TZ_OFFSET_MINUTES * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mês civil BRT atual, na mesma forma. */
export function currentMonthKeyBrt(nowMs: number = Date.now()): string {
  return monthKeyBrt(nowMs);
}

export interface ReferralStatsInput {
  /** Linhas de install_requests com referral_code não nulo. */
  referrals: Array<{ status: string; created_at: number }>;
  /** Ledger completo (créditos e débitos). */
  ledger: Array<{ delta: number; customer_ref: string; created_at: number }>;
  /** Resgates com status. */
  redemptions: Array<{ status: string; points_cost: number }>;
  /** Mês de referência ("2026-09"). Default: mês civil BRT atual. */
  month?: string;
}

export interface ReferralMonthMetrics {
  /** Mês de referência ("2026-09"). */
  month: string;
  /** Indicações (solicitações vindas de link) recebidas no mês. */
  referralsThisMonth: number;
  /** Quantas dessas do mês já foram aprovadas. */
  approvedThisMonth: number;
  /** Taxa de aprovação DO MÊS (%) — null quando não há indicações no mês. */
  approvalRatePct: number | null;
  /** Taxa de aprovação de TODAS as indicações (%) — null quando não há nenhuma. */
  approvalRateAllPct: number | null;
  /** Pontos creditados no mês (aprovações + ajustes positivos). */
  pointsIssuedThisMonth: number;
  /** Total de pontos emitidos desde o início. */
  pointsIssuedTotal: number;
  /** Total resgatado desde o início (custo dos pedidos, qualquer status). */
  pointsRedeemedTotal: number;
  /** Clientes distintos com movimento no ledger. */
  activeCustomers: number;
  /** Resgates aguardando decisão. */
  pendingRedemptions: number;
}

/**
 * Calcula as métricas do card. Tolerante a entradas parciais: o endpoint só
 * alimenta o card quando a migration 011 existe; fora isso o painel mostra o
 * aviso de migration pendente e este módulo nem é chamado.
 */
export function referralDashboardMetrics(input: ReferralStatsInput): ReferralMonthMetrics {
  const month = input.month ?? currentMonthKeyBrt();

  const referralsThisMonth = input.referrals.filter((r) => monthKeyBrt(r.created_at) === month);
  const approvedThisMonth = referralsThisMonth.filter((r) => r.status === "approved");
  const approvedAll = input.referrals.filter((r) => r.status === "approved");
  const decidedAll = input.referrals.filter((r) => r.status === "approved" || r.status === "rejected");

  const ledgerMonth = input.ledger.filter((l) => l.delta > 0 && monthKeyBrt(l.created_at) === month);
  const ledgerPositiveAll = input.ledger.filter((l) => l.delta > 0);

  return {
    month,
    referralsThisMonth: referralsThisMonth.length,
    approvedThisMonth: approvedThisMonth.length,
    approvalRatePct: referralsThisMonth.length
      ? Math.round((approvedThisMonth.length / referralsThisMonth.length) * 100)
      : null,
    approvalRateAllPct: decidedAll.length ? Math.round((approvedAll.length / decidedAll.length) * 100) : null,
    pointsIssuedThisMonth: ledgerMonth.reduce((acc, l) => acc + l.delta, 0),
    pointsIssuedTotal: ledgerPositiveAll.reduce((acc, l) => acc + l.delta, 0),
    pointsRedeemedTotal: input.redemptions.reduce((acc, r) => acc + (r.points_cost || 0), 0),
    activeCustomers: new Set(input.ledger.map((l) => l.customer_ref)).size,
    pendingRedemptions: input.redemptions.filter((r) => r.status === "pending").length,
  };
}
