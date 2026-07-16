/**
 * Invoice Detail Page — Full view of a single billing,
 * including barcode, PIX copy, PDF download, and payment info.
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useState } from "react";
import { useBillings } from "@/hooks/use-billings";
import { useAuth } from "@/lib/auth-context";

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pendente: { label: "Pendente", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400", icon: Clock },
  pago: { label: "Pago", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400", icon: CheckCircle2 },
  vencido: { label: "Vencido", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400", icon: AlertCircle },
  cancelado: { label: "Cancelado", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400", icon: AlertCircle },
};

export default function InvoiceDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { billings, isLoading } = useBillings();
  const { customer } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const rawBilling = billings.find((b) => b.id === id);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Carregando fatura...</p>
      </div>
    );
  }

  if (!rawBilling) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-lg font-medium text-foreground">Fatura não encontrada</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          A fatura que você está procurando não existe ou foi removida.
        </p>
        <Button variant="outline" onClick={() => navigate("/faturas")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para faturas
        </Button>
      </div>
    );
  }

  const billing = rawBilling;

  const status = statusConfig[billing.status] || statusConfig.pendente;
  const StatusIcon = status.icon;

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate("/faturas")}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para faturas
      </button>

      {/* Header */}
      <div className="animate-[fadeIn_0.25s_ease-out]">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-medium tracking-tight text-foreground">
                Fatura {billing.competencia}
              </h1>
              <Badge
                variant="outline"
                className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color}`}
              >
                <StatusIcon className="h-3 w-3 mr-1" />
                {status.label}
              </Badge>
            </div>
          </div>

          <p className="text-2xl font-light tracking-tight text-foreground">
            {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Payment Info Card */}
        <div className="animate-[slideUp_0.3s_ease-out_0.1s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Informações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Competência</span>
                <span className="text-foreground">{billing.competencia}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vencimento</span>
                <span className="text-foreground">{billing.vencimento}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Valor</span>
                <span className="text-foreground font-medium">
                  {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>

              {billing.status === "pago" && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Data do pagamento</span>
                    <span className="text-foreground">{billing.data_pagamento}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Valor pago</span>
                    <span className="text-foreground font-medium">
                      {billing.valor_pago?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Actions Card */}
        <div className="animate-[slideUp_0.3s_ease-out_0.15s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Ações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {billing.status === "pendente" && (
                <>
                  {billing.linha_digitavel && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Linha Digitável
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[10px] font-mono text-foreground bg-secondary/50 px-2 py-1.5 rounded-sm truncate">
                          {billing.linha_digitavel}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopy(billing.linha_digitavel!, "linha")}
                        >
                          {copiedField === "linha" ? (
                            <CopyCheck className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {billing.pix_copiaecola && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        PIX Copia e Cola
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[10px] font-mono text-foreground bg-secondary/50 px-2 py-1.5 rounded-sm truncate">
                          {billing.pix_copiaecola.slice(0, 40)}...
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopy(billing.pix_copiaecola!, "pix")}
                        >
                          {copiedField === "pix" ? (
                            <CopyCheck className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  <Separator />

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-9"
                      onClick={() => handleCopy(billing.linha_digitavel || "", "all")}
                      disabled={!billing.linha_digitavel}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      Copiar linha
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 text-xs h-9"
                      disabled
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download PDF
                    </Button>
                  </div>
                </>
              )}

              {billing.status === "pago" && (
                <div className="text-center py-6">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Fatura paga</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Paga em {billing.data_pagamento}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
