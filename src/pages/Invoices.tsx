/**
 * Invoices Page — Full list of customer invoices with smart ordering.
 * The current/next invoice is highlighted first with "Vence em X dias".
 * Overdue invoices are grouped below, and paid invoices are a discreet list.
 */

import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import InvoiceCard from "@/components/InvoiceCard";
import { InvoicesSkeleton } from "@/components/skeletons";
import {
  useBillings,
  diasAteVencimento,
  extractMesInfo,
  formatCacheAge,
  checkStaleData,
  parseDateBR,
} from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";
import { useBillingContext } from "@/lib/billing-context";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading, isCached, cacheAge } = useBillings();
  const { refetch } = useBillingContext();

  const handleRetry = () => window.location.reload();

  const {
    pullContainerProps,
    PullIndicator,
  } = usePullToRefresh(isLoading, refetch);

  // Separate unpaid and paid invoices
  const { unpaid, paid, currentBilling } = useMemo(() => {
    const allUnpaid = billings
      .filter((b: BillingSummary) => b.status !== "pago" && b.status !== "cancelado")
      .sort((a: BillingSummary, b: BillingSummary) => {
        // Sort by absolute proximity to today (closest due date first)
        const diasA = Math.abs(diasAteVencimento(a.vencimento) ?? 999);
        const diasB = Math.abs(diasAteVencimento(b.vencimento) ?? 999);
        if (diasA !== diasB) return diasA - diasB;
        // Tie-break: overdue first, then by date
        const aOverdue = a.status === "vencido" ? 0 : 1;
        const bOverdue = b.status === "vencido" ? 0 : 1;
        return aOverdue - bOverdue;
      });

    const allPaid = billings
      .filter((b: BillingSummary) => b.status === "pago")
      .sort((a: BillingSummary, b: BillingSummary) => {
        // Sort by due date descending (most recent paid first) — proper Date comparison
        const dateA = parseDateBR(a.vencimento);
        const dateB = parseDateBR(b.vencimento);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB.getTime() - dateA.getTime();
      });

    // The first unpaid is the "current" one
    const current = allUnpaid.length > 0 ? allUnpaid[0] : null;

    return { unpaid: allUnpaid, paid: allPaid, currentBilling: current };
  }, [billings]);

  // Calculate days until due for the current billing
  const currentDias = currentBilling ? diasAteVencimento(currentBilling.vencimento) : null;

  // Build a "vence em" text for the current billing
  const currentVenceText = useMemo(() => {
    if (!currentBilling || currentDias === null) return null;
    if (currentDias < 0) return `Vencida há ${Math.abs(currentDias)} dia${Math.abs(currentDias) !== 1 ? "s" : ""}`;
    if (currentDias === 0) return "Vence hoje";
    if (currentDias === 1) return "Vence amanhã";
    return `Vence em ${currentDias} dias`;
  }, [currentBilling, currentDias]);

  // Stale data detection — shared utility, checks against all billings
  const staleDataWarning = useMemo(() => {
    if (isLoading) return null;
    return checkStaleData(billings, 60);
  }, [billings, isLoading]);

  // ── Group paid invoices by year, sorted descending ──
  const paidByYear = useMemo(() => {
    const groups: { year: string; billings: BillingSummary[] }[] = [];
    const map = new Map<string, BillingSummary[]>();

    for (const b of paid) {
      const mesInfo = extractMesInfo(b.vencimento);
      const year = mesInfo?.ano || "—";
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(b);
    }

    // Sort years descending, within each year sort by date descending
    const sortedYears = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
    for (const year of sortedYears) {
      const billings = map.get(year)!;
      billings.sort((a, b) => {
        const da = parseDateBR(a.vencimento);
        const db = parseDateBR(b.vencimento);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.getTime() - da.getTime();
      });
      groups.push({ year, billings });
    }

    return groups;
  }, [paid]);

  // ── Which years are expanded ──
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => {
    // Auto-expand the current year on first render
    const currentYear = String(new Date().getFullYear());
    return new Set([currentYear]);
  });

  const allExpanded = useMemo(
    () => paidByYear.length > 0 && paidByYear.every(({ year }) => expandedYears.has(year)),
    [paidByYear, expandedYears],
  );

  const toggleAllYears = useCallback(() => {
    setExpandedYears((prev) => {
      if (prev.size === paidByYear.length) {
        // All expanded → collapse all, keep current year
        const currentYear = String(new Date().getFullYear());
        return new Set([currentYear]);
      }
      // Expand all
      return new Set(paidByYear.map((g) => g.year));
    });
  }, [paidByYear]);

  const toggleYear = useCallback((year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }, []);

  return (
    <div
      {...pullContainerProps}
      className="max-w-4xl mx-auto space-y-6 relative"
    >
      <PullIndicator />

      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">Faturas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acompanhe suas cobranças de forma inteligente.
        </p>
      </div>

      {/* Offline/Cached indicator */}
      {!isLoading && isCached && (
        <div className="animate-[slideUp_0.3s_ease-out] flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/10 text-xs text-amber-700 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Dados offline{formatCacheAge(cacheAge) ? ` — última atualização ${formatCacheAge(cacheAge)}` : ""}
          </span>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 font-medium hover:underline shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            Tentar novamente
          </button>
        </div>
      )}

      {/* Stale data warning — all paid invoices and none from the last 45 days */}
      {!isLoading && staleDataWarning && (
        <div className="animate-[slideUp_0.3s_ease-out] flex items-start gap-3 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/10">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              {staleDataWarning.title}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
              {staleDataWarning.message}
            </p>
            <button
              onClick={refetch}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Recarregar faturas
            </button>
          </div>
        </div>
      )}

      {/* Manual refresh button — only when data loaded and not already refreshing */}
      {!isLoading && billings.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={refetch}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading ? (
        <InvoicesSkeleton />
      ) : billings.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma fatura encontrada.</p>
        </div>
      ) : (
        <>
          {/* ── Current invoice (highlighted) ── */}
          {currentBilling && (
            <div className="animate-[slideUp_0.3s_ease-out]">
              <InvoiceCard
                variant="highlight"
                billing={currentBilling}
                venceText={currentVenceText}
                currentDias={currentDias}
                onClick={() => navigate(`/faturas/${currentBilling.id}`)}
              />
            </div>
          )}

          {/* ── Other unpaid invoices ── */}
          {unpaid.length > 1 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-border/30" />
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground shrink-0">
                  {currentBilling ? "Demais faturas" : "Faturas abertas"}
                </span>
                <div className="h-px flex-1 bg-border/30" />
              </div>

              <div className="space-y-2">
                {(unpaid.slice(1)).map((billing: BillingSummary, index: number) => (
                  <div
                    key={billing.id}
                    className="animate-[slideUp_0.2s_ease-out]"
                    style={{ animationDelay: `${0.03 * (index + 1)}s` }}
                  >
                    <InvoiceCard
                      variant="default"
                      billing={billing}
                      onClick={() => navigate(`/faturas/${billing.id}`)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Paid invoices grouped by year (accordion) ── */}
          {paidByYear.length > 0 && (
            <div className="animate-[slideUp_0.3s_ease-out]">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-border/20" />
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50 shrink-0">
                  Pagas
                </span>
                <button
                  onClick={toggleAllYears}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground/70 transition-colors shrink-0"
                >
                  {allExpanded ? "Recolher todos" : "Expandir todos"}
                </button>
                <div className="h-px flex-1 bg-border/20" />
              </div>

              <div className="space-y-2">
                {paidByYear.map(({ year, billings }) => {
                  const isExpanded = expandedYears.has(year);
                  const total = billings.reduce((s, b) => s + b.valor, 0);
                  const count = billings.length;

                  return (
                    <div key={year} className="rounded-lg border border-border/50 overflow-hidden">
                      {/* Year header button */}
                      <button
                        onClick={() => toggleYear(year)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary/30 transition-colors"
                      >
                        <CalendarDays className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        <span>{year}</span>
                        <span className="text-xs text-muted-foreground/60 font-normal">
                          {count} fatura{count !== 1 ? "s" : ""} · {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                        <div className="ml-auto">
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground/50 transition-transform duration-200 ${
                              isExpanded ? "rotate-0" : "-rotate-90"
                            }`}
                          />
                        </div>
                      </button>

                      <div
                        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                        style={{
                          gridTemplateRows: isExpanded ? "1fr" : "0fr",
                        }}
                      >
                        <div className="overflow-hidden min-h-0 transition-opacity duration-300 ease-in-out" style={{ opacity: isExpanded ? 1 : 0 }}>
                          <div className="px-3 pb-2 space-y-0.5">
                          {billings.map((billing: BillingSummary, i: number) => {
                            const mesInfo = extractMesInfo(billing.vencimento);
                            const mesLabel = mesInfo
                              ? `${mesInfo.mesNome} de ${mesInfo.ano}`
                              : billing.competencia || "";
                            return (
                              <div
                                key={billing.id + '-' + isExpanded}
                                className={`${
                                  isExpanded ? "animate-[slideUp_0.2s_ease-out]" : ""
                                }`}
                                style={{
                                  animationDelay: `${0.03 * i}s`,
                                }}
                              >
                                <button
                                  onClick={() => navigate(`/faturas/${billing.id}`)}
                                  className="w-full flex items-center justify-between px-3 py-2 rounded-sm text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 transition-all group"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-500/50 shrink-0" />
                                    <span className="truncate">{mesLabel}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span>
                                      {billing.valor.toLocaleString("pt-BR", {
                                        style: "currency",
                                        currency: "BRL",
                                      })}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] font-medium px-1.5 py-0 border-none text-emerald-600/60 dark:text-emerald-400/60 bg-emerald-50/50 dark:bg-emerald-950/10"
                                    >
                                      Pago
                                    </Badge>
                                    <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}



