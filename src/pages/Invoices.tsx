/**
 * Invoices Page — Full list of customer invoices with smart ordering.
 * The current/next invoice is highlighted first with "Vence em X dias".
 * Overdue invoices are grouped below, and paid invoices are a discreet list.
 */

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle2,
  ChevronRight,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import InvoiceCard from "@/components/InvoiceCard";
import { useBillings, diasAteVencimento, extractMesInfo, formatCacheAge } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading, isCached, cacheAge } = useBillings();

  const handleRetry = () => window.location.reload();

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
        // Sort by due date descending (most recent paid first)
        return b.vencimento.localeCompare(a.vencimento);
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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

          {/* ── Paid invoices (discreet list) ── */}
          {paid.length > 0 && (
            <div className="animate-[slideUp_0.3s_ease-out]">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-border/20" />
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50 shrink-0">
                  Pagas
                </span>
                <div className="h-px flex-1 bg-border/20" />
              </div>

              <div className="space-y-1">
                {paid.map((billing: BillingSummary, index: number) => {
                  const mesInfo = extractMesInfo(billing.vencimento);
                  const mesLabel = billing.competencia || mesInfo?.mesNome || "";
                  return (
                    <button
                      key={billing.id}
                      onClick={() => navigate(`/faturas/${billing.id}`)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-sm text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 transition-all group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500/50 shrink-0" />
                        <span className="truncate">
                          {mesLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span>
                          {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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

// ── Loading skeleton for invoices page ──

function InvoicesSkeleton() {
  return (
    <div className="space-y-6">
      {/* Skeleton header */}
      <div className="space-y-2">
        <div className="h-6 w-24 bg-secondary/60 rounded-sm animate-pulse" />
        <div className="h-4 w-72 bg-secondary/40 rounded-sm animate-pulse" />
      </div>

      {/* Skeleton highlighted card */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="h-10 w-10 rounded-full bg-secondary/50 animate-pulse shrink-0" />
              <div className="space-y-3 min-w-0">
                <div className="h-4 w-32 bg-secondary/50 rounded-full animate-pulse" />
                <div className="h-5 w-40 bg-secondary/60 rounded-sm animate-pulse" />
                <div className="h-3 w-28 bg-secondary/40 rounded-sm animate-pulse" />
              </div>
            </div>
            <div className="text-right space-y-2 shrink-0">
              <div className="h-6 w-24 bg-secondary/60 rounded-sm animate-pulse ml-auto" />
              <div className="h-4 w-16 bg-secondary/40 rounded-sm animate-pulse ml-auto" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex gap-2">
            <div className="h-7 w-28 bg-secondary/40 rounded-sm animate-pulse" />
            <div className="h-7 w-16 bg-secondary/40 rounded-sm animate-pulse" />
            <div className="h-7 w-14 bg-secondary/40 rounded-sm animate-pulse" />
          </div>
        </CardContent>
      </Card>

      {/* Skeleton section divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/20" />
        <div className="h-3 w-28 bg-secondary/40 rounded-sm animate-pulse" />
        <div className="h-px flex-1 bg-border/20" />
      </div>

      {/* Skeleton regular cards */}
      {[1, 2].map((i) => (
        <Card key={i} className="border-border shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-secondary/40 animate-pulse shrink-0" />
                <div className="space-y-2">
                  <div className="h-3 w-20 bg-secondary/40 rounded-full animate-pulse" />
                  <div className="h-3 w-36 bg-secondary/30 rounded-sm animate-pulse" />
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="h-4 w-20 bg-secondary/50 rounded-sm animate-pulse" />
                <div className="h-5 w-14 bg-secondary/40 rounded-sm animate-pulse" />
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-border/50 flex gap-1">
              <div className="h-6 w-24 bg-secondary/30 rounded-sm animate-pulse" />
              <div className="h-6 w-12 bg-secondary/30 rounded-sm animate-pulse" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}


