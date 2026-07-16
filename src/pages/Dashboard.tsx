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
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Wifi,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { useBillings } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

const statusConfig = {
  pendente: { label: "Pendente", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400", icon: Clock },
  pago: { label: "Pago", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400", icon: CheckCircle2 },
  vencido: { label: "Vencido", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400", icon: AlertCircle },
  cancelado: { label: "Cancelado", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400", icon: AlertCircle },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { customer } = useAuth();
  const { billings, isLoading } = useBillings();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pendingBillings = billings.filter((b: BillingSummary) => b.status === "pendente");
  const pendingCount = pendingBillings.length;
  const pendingTotal = pendingBillings.reduce((sum: number, b: BillingSummary) => sum + b.valor, 0);
  const nextDueDate = pendingBillings[0]?.vencimento;

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="animate-[slideUp_0.3s_ease-out_0.05s_both]">
          <Card className="border-border shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                  <FileText className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-light tracking-tight">{pendingCount}</p>
                  <p className="text-xs text-muted-foreground">Faturas pendentes</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
      </div>

      {/* Recent Billings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground">Faturas Recentes</h2>
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

        <div className="space-y-2">
          {billings.slice(0, 3).map((billing, index) => {
            const status = statusConfig[billing.status] || statusConfig.pendente;
            const StatusIcon = status.icon;

            return (
              <div
                key={billing.id}
                className="animate-[slideUp_0.2s_ease-out]"
                style={{ animationDelay: `${0.05 * index}s` }}
              >
                <Card
                  className="border-border shadow-none hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/faturas/${billing.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="hidden sm:flex h-9 w-9 rounded-full bg-secondary items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {billing.competencia}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Vencimento: {billing.vencimento}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
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

                    {/* Quick actions for pending bills */}
                    {billing.status === "pendente" && billing.linha_digitavel && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground ml-auto"
                          onClick={(e) => {
                            e.stopPropagation();
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
          })}
        </div>
      </div>
    </div>
  );
}
