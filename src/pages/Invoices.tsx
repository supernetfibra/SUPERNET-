/**
 * Invoices Page — Full list of customer invoices with filtering,
 * status indicators, and quick actions (download PDF, copy PIX/linha).
 * Uses CSS animations instead of framer-motion.
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
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useState } from "react";
import { useBillings } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

const statusConfig = {
  pendente: { label: "Pendente", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400", icon: Clock },
  pago: { label: "Pago", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400", icon: CheckCircle2 },
  vencido: { label: "Vencido", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400", icon: AlertCircle },
  cancelado: { label: "Cancelado", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400", icon: AlertCircle },
};

type FilterStatus = "all" | "pendente" | "pago" | "vencido";

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading } = useBillings();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const filteredBillings = filter === "all"
    ? billings
    : billings.filter((b: BillingSummary) => b.status === filter);

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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">Faturas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico completo de suas cobranças.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-sm border border-border overflow-hidden">
          {(["all", "pendente", "pago"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-xs transition-colors ${
                filter === f
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {f === "all" ? "Todas" : f === "pendente" ? "Pendentes" : "Pagas"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground ml-auto">
          {filteredBillings.length} fatura{filteredBillings.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Billing List */}
      {isLoading ? (
        <div className="text-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Carregando faturas...</p>
        </div>
      ) : filteredBillings.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma fatura encontrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBillings.map((billing, index) => {
            const status = statusConfig[billing.status] || statusConfig.pendente;
            const StatusIcon = status.icon;

            return (
              <div
                key={billing.id}
                className="animate-[slideUp_0.2s_ease-out]"
                style={{ animationDelay: `${0.03 * index}s` }}
              >
                <Card
                  className="border-border shadow-none hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/faturas/${billing.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {billing.competencia}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Vencimento: {billing.vencimento}
                            {billing.status === "pago" && billing.data_pagamento && (
                              <> · Pago em: {billing.data_pagamento}</>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">
                            {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </p>
                          {billing.status === "pago" && billing.valor_pago && (
                            <p className="text-[10px] text-muted-foreground">
                              Pago
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color}`}
                        >
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {status.label}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>

                    {/* Quick actions for pending */}
                    {billing.status === "pendente" && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
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
      )}
    </div>
  );
}
