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
  Calendar,
  AlertTriangle,
  WifiOff,
  RefreshCw,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBillings, diasAteVencimento, formatCacheAge } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const navigate = useNavigate();
  const { customer } = useAuth();
  const { billings, isLoading, isCached, cacheAge } = useBillings();

  const pendingBillings = billings.filter((b: BillingSummary) => b.status === "pendente");
  const overdueBillings = billings.filter((b: BillingSummary) => b.status === "vencido");
  const activeBillings = [...overdueBillings, ...pendingBillings];

  // Real next due date — find the closest upcoming (>= today), or the most recent overdue
  const nextDueInfo = useMemo(() => {
    if (activeBillings.length === 0) return null;

    let upcoming: BillingSummary | null = null;
    let closestDias = Infinity;

    for (const b of activeBillings) {
      const dias = diasAteVencimento(b.vencimento);
      if (dias === null) continue;

      // Upcoming (>= today) — find the smallest non-negative value
      if (dias >= 0 && dias < closestDias) {
        closestDias = dias;
        upcoming = b;
      }
    }

    // If an upcoming billing was found, use it
    if (upcoming) {
      const dias = closestDias;
      let label = "";
      if (dias === 0) label = "Vence hoje";
      else if (dias === 1) label = "Vence amanhã";
      else label = `Vence em ${dias} dias`;
      return { billing: upcoming, label, isOverdue: false, dias };
    }

    // All are overdue — find the most recent one (largest dias, closest to zero)
    let mostRecent: BillingSummary | null = null;
    let maxDias = -Infinity;
    for (const b of activeBillings) {
      const dias = diasAteVencimento(b.vencimento);
      if (dias === null) continue;
      if (dias > maxDias) {
        maxDias = dias;
        mostRecent = b;
      }
    }

    if (mostRecent) {
      const diasAtraso = Math.abs(maxDias);
      const label =
        diasAtraso === 0
          ? "Vence hoje"
          : diasAtraso === 1
          ? "Vencida há 1 dia"
          : `Vencida há ${diasAtraso} dias`;
      return { billing: mostRecent, label, isOverdue: true, dias: maxDias };
    }

    return null;
  }, [activeBillings]);

  // Retry when offline — reload to attempt fresh fetch
  const handleRetry = () => window.location.reload();

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

      {/* Next due date */}
      {!isLoading && (
        <div className="animate-[slideUp_0.3s_ease-out]">
          <Card className={`border shadow-none ${
            nextDueInfo?.isOverdue
              ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10"
              : nextDueInfo && nextDueInfo.dias <= 3
              ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10"
              : "border-border"
          }`}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  nextDueInfo?.isOverdue
                    ? "bg-red-100 dark:bg-red-900/30"
                    : nextDueInfo && nextDueInfo.dias <= 3
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : "bg-secondary"
                }`}>
                  <Calendar className={`h-4 w-4 ${
                    nextDueInfo?.isOverdue
                      ? "text-red-600 dark:text-red-400"
                      : nextDueInfo && nextDueInfo.dias <= 3
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground"
                  }`} />
                </div>
                <div>
                  <p className="text-sm font-medium tracking-tight">
                    {nextDueInfo?.billing?.vencimento || "—"}
                  </p>
                  <p className={`text-xs ${
                    nextDueInfo?.isOverdue
                      ? "text-red-600 dark:text-red-400 font-medium"
                      : nextDueInfo && nextDueInfo.dias <= 3
                      ? "text-amber-600 dark:text-amber-400 font-medium"
                      : "text-muted-foreground"
                  }`}>
                    {nextDueInfo?.label || "Nenhuma fatura pendente"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
