/**
 * InvoiceCard — Unified component for displaying billing invoice cards.
 * Replaces 3 duplicate implementations (InvoiceCardHighlight, InvoiceCard in Invoices.tsx,
 * and InvoiceCard in Dashboard.tsx).
 *
 * Variants:
 *   - highlight  → Large card with urgency styling, "Vence em X dias" badge
 *   - default    → Compact card for list views (Invoices page)
 *   - dashboard  → Compact card with "Pagar" CTA button (Dashboard page)
 *
 * Copy state: pass `copiedId`/`handleCopy` from parent for shared state across cards,
 * or omit them to use internal per-card copy state.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  ChevronRight,
  AlertTriangle,
  Clock,
  Zap,
  CalendarDays,
  CreditCard,
  Smartphone,
} from "lucide-react";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getSmartLabel, diasAteVencimento } from "@/hooks/use-billings";
import { statusConfig } from "@/lib/status-config";
import type { BillingSummary } from "@/hooks/use-billings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceCardVariant = "highlight" | "default" | "dashboard";

interface InvoiceCardProps {
  billing: BillingSummary;
  variant?: InvoiceCardVariant;
  onClick?: () => void;
  /** External copy state (shared across sibling cards). Falls back to internal state. */
  copiedId?: string | null;
  handleCopy?: (text: string, id: string) => void;
  /** Only for highlight variant — urgency text like "Vence em 5 dias" */
  venceText?: string | null;
  /** Only for highlight variant — days until/overdue for urgency styling */
  currentDias?: number | null;
}

// ---------------------------------------------------------------------------
// Styling helpers — map smartLabel type to visual styles
// ---------------------------------------------------------------------------

function getUrgencyStyles(type: string) {
  switch (type) {
    case "vencida":
      return {
        cardAccent:
          "border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-900/50",
        cardBorder:
          "border-red-200 dark:border-red-800/60 bg-red-50/50 dark:bg-red-950/10 hover:bg-red-100/50 dark:hover:bg-red-950/30",
        iconBg: "bg-red-100 dark:bg-red-900/30",
        iconColor: "text-red-600 dark:text-red-400",
        labelBg:
          "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
        Icon: AlertTriangle,
      };
    case "vence-hoje":
      return {
        cardAccent:
          "border-orange-400 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/20 ring-1 ring-orange-200 dark:ring-orange-900/50",
        cardBorder:
          "border-orange-200 dark:border-orange-800/60 bg-orange-50/50 dark:bg-orange-950/10 hover:bg-orange-100/50 dark:hover:bg-orange-950/30",
        iconBg: "bg-orange-100 dark:bg-orange-900/30",
        iconColor: "text-orange-600 dark:text-orange-400",
        labelBg:
          "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
        Icon: Zap,
      };
    case "a-vencer":
      return {
        cardAccent:
          "border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/15 ring-1 ring-amber-200/50 dark:ring-amber-900/30",
        cardBorder:
          "border-amber-200 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/5 hover:bg-amber-100/30 dark:hover:bg-amber-950/20",
        iconBg: "bg-amber-100 dark:bg-amber-900/30",
        iconColor: "text-amber-600 dark:text-amber-400",
        labelBg:
          "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
        Icon: Clock,
      };
    default:
      return {
        cardAccent:
          "border-border bg-card ring-1 ring-border/50",
        cardBorder:
          "border-border hover:bg-secondary/30",
        iconBg: "bg-secondary",
        iconColor: "text-muted-foreground",
        labelBg: "bg-secondary text-muted-foreground",
        Icon: FileText,
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InvoiceCard({
  billing,
  variant = "default",
  onClick,
  copiedId: extCopiedId,
  handleCopy: extHandleCopy,
  venceText,
  currentDias,
}: InvoiceCardProps) {
  // Use external copy state if provided, otherwise internal
  const [intCopiedId, intHandleCopy] = useCopyToClipboard();
  const copiedId = extCopiedId !== undefined ? extCopiedId : intCopiedId;
  const handleCopy = extHandleCopy || intHandleCopy;

  const smartLabel = getSmartLabel(billing);
  const styles = getUrgencyStyles(smartLabel.type);
  const status = statusConfig[billing.status] || statusConfig.pendente;
  const StatusIcon = status.icon;

  // Highlight variant uses explicit currentDias for styling
  // (it may differ from smartLabel when user passes custom venceText)
  const highlightStyles =
    variant === "highlight"
      ? getUrgencyStyles(
          currentDias !== null && currentDias !== undefined
            ? currentDias < 0
              ? "vencida"
              : currentDias === 0
              ? "vence-hoje"
              : currentDias <= 7
              ? "a-vencer"
              : "normal"
            : smartLabel.type
        )
      : null;

  const activeStyles = highlightStyles || styles;

  const isPending =
    billing.status === "pendente" || billing.status === "vencido";

  // ── Highlight variant ──

  if (variant === "highlight") {
    return (
      <Card
        className={`border shadow-sm transition-all cursor-pointer hover:shadow-md ${activeStyles.cardAccent}`}
        onClick={onClick}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${activeStyles.iconBg}`}
              >
                <styles.Icon className={`h-5 w-5 ${activeStyles.iconColor}`} />
              </div>

              <div className="min-w-0 space-y-1.5">
                {/* Vence em X dias badge */}
                {venceText && (
                  <span
                    className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${activeStyles.labelBg}`}
                  >
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
                {billing.valor.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </p>
              <Badge
                variant="outline"
                className={`mt-1 text-[10px] font-medium px-2 py-0.5 border-none ${status.color} shrink-0`}
              >
                {status.label}
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
            )}
            {billing.url_boleto && (
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

  // ── Dashboard variant ──

  if (variant === "dashboard") {
    return (
      <Card
        className={`border shadow-none transition-all cursor-pointer ${styles.cardBorder}`}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`hidden sm:flex h-9 w-9 rounded-full items-center justify-center shrink-0 ${styles.iconBg}`}
              >
                <styles.Icon
                  className={`h-4 w-4 ${styles.iconColor}`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${styles.labelBg}`}
                  >
                    {smartLabel.text}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {billing.vencimento}
                  {billing.competencia && (
                    <> · Ref. {billing.competencia}</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">
                  {billing.valor.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color}`}
              >
                <StatusIcon className="h-3 w-3 mr-1" />
                {status.label}
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            </div>
          </div>

          {/* Quick actions with "Pagar" CTA */}
          {isPending && (
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.();
                }}
              >
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Pagar
              </Button>

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
                  Copiar código
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
                    <Smartphone className="h-3 w-3 mr-1" />
                  )}
                  Pix
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    `/api/mikweb/billings/${billing.id}/download`,
                    "_blank"
                  );
                }}
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Default variant (compact, for Invoices list) ──

  return (
    <Card
      className={`border shadow-none transition-all cursor-pointer ${styles.cardBorder}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${styles.iconBg}`}
            >
              <styles.Icon className={`h-4 w-4 ${styles.iconColor}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${styles.labelBg}`}
                >
                  {smartLabel.text}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {billing.vencimento}
                {billing.competencia && (
                  <> · Ref. {billing.competencia}</>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <p className="text-sm font-medium text-foreground whitespace-nowrap">
              {billing.valor.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </p>
            <Badge
              variant="outline"
              className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color} shrink-0`}
            >
              {status.label}
            </Badge>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 hidden sm:block" />
          </div>
        </div>

        {/* Quick actions */}
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
