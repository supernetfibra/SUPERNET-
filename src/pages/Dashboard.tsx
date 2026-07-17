/**
 * Dashboard Page — Shows a summary of the customer's account,
 * including pending invoices, next due date, and quick actions.
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  Calendar,
  ChevronRight,
  TrendingDown,
  AlertTriangle,
  Clock,
  Zap,
  CreditCard,
  CheckCircle2,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBillings, formatVencimentoComMes, getSmartLabel } from "@/hooks/use-billings";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusConfig } from "@/lib/status-config";
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
// Invoice card component (with Pagar CTA)
// ---------------------------------------------------------------------------
function InvoiceCard({
  billing,
  index,
  copiedId,
  handleCopy,
  navigate,
}: {
  billing: BillingSummary;
  index: number;
  copiedId: string | null;
  handleCopy: (text: string, id: string) => void;
  navigate: (path: string) => void;
}) {
  const status = statusConfig[billing.status] || statusConfig.pendente;
  const StatusIcon = status.icon;
  const smartLabel = getSmartLabel(billing);

  const isPending = billing.status === "pendente" || billing.status === "vencido";

  const cardStyle =
    smartLabel.type === "vencida"
      ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40"
      : smartLabel.type === "vence-hoje"
      ? "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/40"
      : smartLabel.type === "a-vencer"
      ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-100/50 dark:hover:bg-amber-950/30"
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

  return (
    <div
      className="animate-[slideUp_0.2s_ease-out]"
      style={{ animationDelay: `${0.05 * index}s` }}
    >
      <Card
        className={`border shadow-none transition-all cursor-pointer ${cardStyle}`}
        onClick={() => navigate(`/faturas/${billing.id}`)}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`hidden sm:flex h-9 w-9 rounded-full items-center justify-center shrink-0 ${
                  smartLabel.type === "vencida"
                    ? "bg-red-100 dark:bg-red-900/30"
                    : smartLabel.type === "vence-hoje"
                    ? "bg-orange-100 dark:bg-orange-900/30"
                    : smartLabel.type === "a-vencer"
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : "bg-secondary"
                }`}
              >
                <SmartIcon
                  className={`h-4 w-4 ${
                    smartLabel.type === "vencida"
                      ? "text-red-600 dark:text-red-400"
                      : smartLabel.type === "vence-hoje"
                      ? "text-orange-600 dark:text-orange-400"
                      : smartLabel.type === "a-vencer"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  }`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${labelBadgeStyle}`}
                  >
                    {smartLabel.text}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {billing.competencia}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">
                  {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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

          {/* Quick actions */}
          {isPending && (
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
              {/* Primary CTA: Pagar */}
              <Button
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/faturas/${billing.id}`);
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
                  window.open(`/api/mikweb/billings/${billing.id}/download`, "_blank");
                }}
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
            </div>
          )}
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
  const { billings, isLoading } = useBillings();
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
  const lastPayment = paidBillings.sort((a, b) => {
    const dateA = a.data_pagamento || "";
    const dateB = b.data_pagamento || "";
    return dateB.localeCompare(dateA);
  })[0];

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
                    <InvoiceCard
                      key={billing.id}
                      billing={billing}
                      index={i}
                      copiedId={copiedId}
                      handleCopy={handleCopy}
                      navigate={navigate}
                    />
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
                    <InvoiceCard
                      key={billing.id}
                      billing={billing}
                      index={overdueGroup.length + i}
                      copiedId={copiedId}
                      handleCopy={handleCopy}
                      navigate={navigate}
                    />
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
