/**
 * Invoices Page — Full list of customer invoices with smart ordering.
 * The current/next invoice is highlighted first with "Vence em X dias".
 * Overdue invoices are grouped below, and paid invoices are a discreet list.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Clock,
  Zap,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useBillings, diasAteVencimento, getSmartLabel, extractMesInfo } from "@/hooks/use-billings";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusConfig } from "@/lib/status-config";
import type { BillingSummary } from "@/hooks/use-billings";

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading } = useBillings();
  const [copiedId, handleCopy] = useCopyToClipboard();

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

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Carregando faturas...</p>
        </div>
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
              <InvoiceCardHighlight
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

// ── Highlighted card for the current invoice ──

function InvoiceCardHighlight({
  billing,
  venceText,
  currentDias,
  onClick,
}: {
  billing: BillingSummary;
  venceText: string | null;
  currentDias: number | null;
  onClick: () => void;
}) {
  const [copiedId, handleCopy] = useCopyToClipboard();
  const smartLabel = getSmartLabel(billing);

  // Determine card styling based on urgency
  const isVencida = billing.status === "vencido" || (currentDias !== null && currentDias < 0);
  const isVenceHoje = currentDias === 0;
  const isPerto = currentDias !== null && currentDias > 0 && currentDias <= 7;

  const cardAccent = isVencida
    ? "border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-900/50"
    : isVenceHoje
    ? "border-orange-400 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/20 ring-1 ring-orange-200 dark:ring-orange-900/50"
    : isPerto
    ? "border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/15 ring-1 ring-amber-200/50 dark:ring-amber-900/30"
    : "border-border bg-card ring-1 ring-border/50";

  const iconColor = isVencida
    ? "text-red-600 dark:text-red-400"
    : isVenceHoje
    ? "text-orange-600 dark:text-orange-400"
    : isPerto
    ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  const iconBg = isVencida
    ? "bg-red-100 dark:bg-red-900/30"
    : isVenceHoje
    ? "bg-orange-100 dark:bg-orange-900/30"
    : isPerto
    ? "bg-amber-100 dark:bg-amber-900/30"
    : "bg-secondary";

  const IconComponent = isVencida
    ? AlertTriangle
    : isVenceHoje
    ? Zap
    : isPerto
    ? Clock
    : CalendarDays;

  const labelBg = isVencida
    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
    : isVenceHoje
    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
    : isPerto
    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
    : "bg-secondary text-muted-foreground";

  return (
    <Card
      className={`border shadow-sm transition-all cursor-pointer hover:shadow-md ${cardAccent}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
              <IconComponent className={`h-5 w-5 ${iconColor}`} />
            </div>

            <div className="min-w-0 space-y-1.5">
              {/* Vence em X dias badge */}
              {venceText && (
                <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${labelBg}`}>
                  {venceText}
                </span>
              )}

              {/* Competência */}
              <p className="text-sm font-medium text-foreground">
                {billing.competencia || "Fatura"}
              </p>

              <p className="text-xs text-muted-foreground">
                Vencimento: {billing.vencimento}
              </p>
            </div>
          </div>

          {/* Value & status */}
          <div className="text-right shrink-0">
            <p className="text-lg font-semibold text-foreground">
              {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <Badge
              variant="outline"
              className={`mt-1 text-[10px] font-medium px-2 py-0.5 border-none ${statusConfig[billing.status]?.color || ""} shrink-0`}
            >
              {statusConfig[billing.status]?.label || billing.status}
            </Badge>
          </div>
        </div>

        {/* Quick actions */}
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
          {billing.linha_digitavel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(billing.linha_digitavel!, `line-${billing.id}`);
              }}
            >
              {copiedId === `line-${billing.id}` ? (
                <CopyCheck className="h-3 w-3 mr-1" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              Linha digitável
            </Button>
          )}
          {billing.pix_copiaecola && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(billing.pix_copiaecola!, `pix-${billing.id}`);
              }}
            >
              {copiedId === `pix-${billing.id}` ? (
                <CopyCheck className="h-3 w-3 mr-1" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              PIX
            </Button>
          )}              {billing.url_boleto && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(billing.url_boleto!, "_blank");
                  }}
                >
                  <Download className="h-3 w-3 mr-1" />
                  PDF
                </Button>
              )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Regular card for other unpaid invoices ──

function InvoiceCard({
  billing,
  onClick,
}: {
  billing: BillingSummary;
  onClick: () => void;
}) {
  const [copiedId, handleCopy] = useCopyToClipboard();
  const smartLabel = getSmartLabel(billing);

  const cardStyle =
    smartLabel.type === "vencida"
      ? "border-red-200 dark:border-red-800/60 bg-red-50/50 dark:bg-red-950/10 hover:bg-red-100/50 dark:hover:bg-red-950/30"
      : smartLabel.type === "vence-hoje"
      ? "border-orange-200 dark:border-orange-800/60 bg-orange-50/50 dark:bg-orange-950/10 hover:bg-orange-100/50 dark:hover:bg-orange-950/30"
      : smartLabel.type === "a-vencer"
      ? "border-amber-200 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/5 hover:bg-amber-100/30 dark:hover:bg-amber-950/20"
      : "border-border hover:bg-secondary/30";

  const labelBadgeStyle =
    smartLabel.type === "vencida"
      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
      : smartLabel.type === "vence-hoje"
      ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
      : smartLabel.type === "a-vencer"
      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
      : "bg-secondary text-muted-foreground";

  const SmartIcon =
    smartLabel.type === "vencida"
      ? AlertTriangle
      : smartLabel.type === "vence-hoje"
      ? Zap
      : smartLabel.type === "a-vencer"
      ? Clock
      : FileText;

  const iconBg =
    smartLabel.type === "vencida"
      ? "bg-red-100 dark:bg-red-900/30"
      : smartLabel.type === "vence-hoje"
      ? "bg-orange-100 dark:bg-orange-900/30"
      : smartLabel.type === "a-vencer"
      ? "bg-amber-100 dark:bg-amber-900/30"
      : "bg-secondary";

  const iconColor =
    smartLabel.type === "vencida"
      ? "text-red-600 dark:text-red-400"
      : smartLabel.type === "vence-hoje"
      ? "text-orange-600 dark:text-orange-400"
      : smartLabel.type === "a-vencer"
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  return (
    <Card
      className={`border shadow-none transition-all cursor-pointer ${cardStyle}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
              <SmartIcon className={`h-4 w-4 ${iconColor}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${labelBadgeStyle}`}>
                  {smartLabel.text}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {billing.vencimento}
                {billing.competencia && <> · Ref. {billing.competencia}</>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <p className="text-sm font-medium text-foreground whitespace-nowrap">
              {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <Badge
              variant="outline"
              className={`text-[10px] font-medium px-2 py-0.5 border-none ${statusConfig[billing.status]?.color || ""} shrink-0`}
            >
              {statusConfig[billing.status]?.label || billing.status}
            </Badge>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 hidden sm:block" />
          </div>
        </div>

        {/* Quick actions for unpaid */}
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-1 flex-wrap">
          {billing.linha_digitavel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-2"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(billing.linha_digitavel!, `line-${billing.id}`);
              }}
            >
              {copiedId === `line-${billing.id}` ? (
                <CopyCheck className="h-2.5 w-2.5 mr-1" />
              ) : (
                <Copy className="h-2.5 w-2.5 mr-1" />
              )}
              Linha digitável
            </Button>
          )}
          {billing.pix_copiaecola && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-2"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(billing.pix_copiaecola!, `pix-${billing.id}`);
              }}
            >
              {copiedId === `pix-${billing.id}` ? (
                <CopyCheck className="h-2.5 w-2.5 mr-1" />
              ) : (
                <Copy className="h-2.5 w-2.5 mr-1" />
              )}
              PIX
            </Button>
          )}
          {billing.url_boleto && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-2"
              onClick={(e) => {
                e.stopPropagation();
                window.open(billing.url_boleto!, "_blank");
              }}
            >
              <Download className="h-2.5 w-2.5 mr-1" />
              PDF
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
