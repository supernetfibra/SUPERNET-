/**
 * Dashboard Page — Shows a summary of the customer's account,
 * including pending invoices, next due date, and quick actions.
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  FileText,
  Calendar,
  ChevronRight,
  TrendingDown,
  AlertTriangle,
  Clock,
  CheckCircle2,
  WifiOff,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import InvoiceCard from "@/components/InvoiceCard";
import { useBillings, diasAteVencimento, formatCacheAge } from "@/hooks/use-billings";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import type { BillingSummary } from "@/hooks/use-billings";

// ---------------------------------------------------------------------------
// Skeleton component for summary card loading state
// ---------------------------------------------------------------------------
function SummarySkeleton({ delay }: { delay: string }) {
  return (
    <div
      className="animate-[slideUp_0.3s_ease-out_both]"
      style={{ animationDelay: delay }}
    >
      <Card className="border-border shadow-none">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-secondary animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-7 w-24 bg-secondary/70 rounded-sm animate-pulse" />
              <div className="h-3 w-20 bg-secondary/50 rounded-sm animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------
function SectionHeader({
  title,
  icon: Icon,
  color,
}: {
  title: string;
  icon: LucideIcon;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`h-6 w-6 rounded-full flex items-center justify-center ${color}`}>
        <Icon className="h-3 w-3" />
      </div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const navigate = useNavigate();
  const { customer } = useAuth();
  const { billings, isLoading, isCached, cacheAge } = useBillings();
  const [copiedId, handleCopy] = useCopyToClipboard();

  const pendingBillings = billings.filter((b: BillingSummary) => b.status === "pendente");
  const overdueBillings = billings.filter((b: BillingSummary) => b.status === "vencido");
  const paidBillings = billings.filter((b: BillingSummary) => b.status === "pago");
  const activeBillings = [...overdueBillings, ...pendingBillings];
  const pendingCount = pendingBillings.length + overdueBillings.length;
  const pendingTotal = [...pendingBillings, ...overdueBillings].reduce(
    (sum: number, b: BillingSummary) => sum + b.valor, 0
  );
  const nextDueDate = activeBillings[0]?.vencimento;

  // Last payment info
  // Retry when offline — reload to attempt fresh fetch
  const handleRetry = () => window.location.reload();

  const lastPayment = paidBillings.sort((a, b) => {
    const dateA = a.data_pagamento || "";
    const dateB = b.data_pagamento || "";
    return dateB.localeCompare(dateA);
  })[0];

  // ── Warning banner state ──
  const [dismissedBanner, setDismissedBanner] = useState(() => {
    try {
      return sessionStorage.getItem("mikweb_dismissed_banner") === "true";
    } catch { return false; }
  });

  const bannerInfo = useMemo(() => {
    if (overdueBillings.length > 0) {
      const total = overdueBillings.reduce((s: number, b: BillingSummary) => s + b.valor, 0);
      return {
        variant: "danger" as const,
        title: `${overdueBillings.length} fatura${overdueBillings.length !== 1 ? "s" : ""} vencida${overdueBillings.length !== 1 ? "s" : ""}`,
        message: `Você tem ${overdueBillings.length} fatura${overdueBillings.length !== 1 ? "s" : ""} em atraso, totalizando ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Regularize para evitar multas e juros.`,
        action: "Ver faturas vencidas",
      };
    }

    if (pendingBillings.length > 0) {
      const expiringSoon = pendingBillings.filter((b: BillingSummary) => {
        const dias = diasAteVencimento(b.vencimento);
        return dias !== null && dias >= 0 && dias <= 3;
      });

      if (expiringSoon.length > 0) {
        const dias = diasAteVencimento(expiringSoon[0].vencimento);
        let msg = "";
        if (dias === 0) msg = "Vence hoje! Não deixe para depois.";
        else if (dias === 1) msg = "Vence amanhã! Evite atrasos.";
        else msg = `Vence em ${dias} dias. Programe o pagamento.`;

        return {
          variant: "warning" as const,
          title: `${expiringSoon.length} fatura${expiringSoon.length !== 1 ? "s" : ""} perto${expiringSoon.length !== 1 ? "s" : ""} do vencimento`,
          message: msg,
          action: "Ver faturas",
        };
      }
    }

    return null;
  }, [overdueBillings, pendingBillings]);

  const dismissBanner = () => {
    setDismissedBanner(true);
    try { sessionStorage.setItem("mikweb_dismissed_banner", "true"); } catch {}
  };

  // Group invoices by overdue / to-expire
  const groupedActive = activeBillings.slice(0, 5);
  const overdueGroup = groupedActive.filter(
    (b) => b.status === "vencido"
  );
  const toExpireGroup = groupedActive.filter(
    (b) => b.status !== "vencido"
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Olá, {customer?.name?.split(" ")[0] || "Cliente"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bem-vindo à sua área do cliente.
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

      {/* Warning Banner */}
      {!dismissedBanner && !isLoading && bannerInfo && (
        <div
          className={`animate-[slideUp_0.3s_ease-out] rounded-lg border px-4 py-3 flex items-start gap-3 ${
            bannerInfo.variant === "danger"
              ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20"
              : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20"
          }`}
        >
          <div className={`shrink-0 mt-0.5 ${
            bannerInfo.variant === "danger"
              ? "text-red-500 dark:text-red-400"
              : "text-amber-500 dark:text-amber-400"
          }`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${
              bannerInfo.variant === "danger"
                ? "text-red-800 dark:text-red-200"
                : "text-amber-800 dark:text-amber-200"
            }`}>
              {bannerInfo.title}
            </p>
            <p className={`text-xs mt-1 ${
              bannerInfo.variant === "danger"
                ? "text-red-700 dark:text-red-300"
                : "text-amber-700 dark:text-amber-300"
            }`}>
              {bannerInfo.message}
            </p>
            <Button
              variant="link"
              size="sm"
              className={`h-auto p-0 mt-2 text-xs font-medium ${
                bannerInfo.variant === "danger"
                  ? "text-red-700 dark:text-red-300 hover:text-red-800"
                  : "text-amber-700 dark:text-amber-300 hover:text-amber-800"
              }`}
              onClick={() => navigate("/faturas")}
            >
              {bannerInfo.action} →
            </Button>
          </div>
          <button
            onClick={dismissBanner}
            className={`shrink-0 p-0.5 rounded-sm transition-opacity hover:opacity-70 ${
              bannerInfo.variant === "danger"
                ? "text-red-400 dark:text-red-500"
                : "text-amber-400 dark:text-amber-500"
            }`}
            aria-label="Fechar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {isLoading ? (
          <>
            <SummarySkeleton delay="0.05s" />
            <SummarySkeleton delay="0.1s" />
            <SummarySkeleton delay="0.15s" />
          </>
        ) : (
          <>
            {/* Pending invoices count */}
            <div className="animate-[slideUp_0.3s_ease-out_0.05s_both]">
              <Card className={`border shadow-none ${
                overdueBillings.length > 0
                  ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10"
                  : "border-border"
              }`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      overdueBillings.length > 0
                        ? "bg-red-100 dark:bg-red-900/30"
                        : "bg-secondary"
                    }`}>
                      <FileText className={`h-4 w-4 ${
                        overdueBillings.length > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-foreground"
                      }`} />
                    </div>
                    <div>
                      <p className="text-2xl font-light tracking-tight">
                        {overdueBillings.length > 0 ? (
                          <span className="text-red-600 dark:text-red-400">{pendingCount}</span>
                        ) : (
                          pendingCount
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">Faturas pendentes</p>
                      {overdueBillings.length > 0 && (
                        <p className="text-[10px] text-red-500 font-medium">
                          {overdueBillings.length} vencida{overdueBillings.length !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Total amount */}
            <div className="animate-[slideUp_0.3s_ease-out_0.1s_both]">
              <Card className="border-border shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                      <TrendingDown className="h-4 w-4 text-foreground" />
                    </div>
                    <div>
                      <p className="text-2xl font-light tracking-tight">
                        {pendingTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                      <p className="text-xs text-muted-foreground">Valor total a pagar</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Next due date */}
            <div className="animate-[slideUp_0.3s_ease-out_0.15s_both]">
              <Card className="border-border shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium tracking-tight">
                        {nextDueDate || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">Próximo vencimento</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Invoices Section */}
      {isLoading ? (
        /* Skeleton for invoice list */
        <div className="space-y-4">
          <div className="h-4 w-32 bg-secondary/70 rounded-sm animate-pulse" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <Card className="border-border shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="h-9 w-9 rounded-full bg-secondary/50" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-40 bg-secondary/50 rounded-sm" />
                        <div className="h-2 w-24 bg-secondary/30 rounded-sm" />
                      </div>
                      <div className="h-4 w-20 bg-secondary/50 rounded-sm" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      ) : groupedActive.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground">
              {overdueBillings.length > 0
                ? "Faturas para Regularizar"
                : "Próximas Faturas"}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/faturas")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Ver todas
              <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>

          <div className="space-y-4">
            {/* Overdue group */}
            {overdueGroup.length > 0 && (
              <div>
                <SectionHeader
                  title="Vencidas"
                  icon={AlertTriangle}
                  color="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                />
                <div className="space-y-2">
                  {overdueGroup.map((billing, i) => (
                    <div
                      key={billing.id}
                      className="animate-[slideUp_0.2s_ease-out]"
                      style={{ animationDelay: `${0.05 * i}s` }}
                    >
                      <InvoiceCard
                        variant="dashboard"
                        billing={billing}
                        copiedId={copiedId}
                        handleCopy={handleCopy}
                        onClick={() => navigate(`/faturas/${billing.id}`)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* To-expire group */}
            {toExpireGroup.length > 0 && (
              <div>
                <SectionHeader
                  title="A Vencer"
                  icon={Clock}
                  color="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                />
                <div className="space-y-2">
                  {toExpireGroup.map((billing, i) => (
                    <div
                      key={billing.id}
                      className="animate-[slideUp_0.2s_ease-out]"
                      style={{ animationDelay: `${0.05 * (overdueGroup.length + i)}s` }}
                    >
                      <InvoiceCard
                        variant="dashboard"
                        billing={billing}
                        copiedId={copiedId}
                        handleCopy={handleCopy}
                        onClick={() => navigate(`/faturas/${billing.id}`)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Empty state — tudo em dia */
        <div className="text-center py-12">
          <div className="inline-flex h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/20 items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 dark:text-emerald-400" />
          </div>
          <p className="text-base font-medium text-foreground mb-1">
            Tudo em dia! 🎉
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Nenhuma fatura pendente encontrada.
          </p>
          {lastPayment && (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>
                Último pagamento:{" "}
                <span className="font-medium text-foreground">
                  {lastPayment.valor?.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
                {lastPayment.data_pagamento && (
                  <> em {lastPayment.data_pagamento}</>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
