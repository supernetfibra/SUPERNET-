/**
 * Invoice Detail Page — Full view of a single billing,
 * including barcode, PIX copy, PDF download, and payment info.
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
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  Calendar,
  DollarSign,
  Barcode,
  Wifi,
  QrCode,
  Printer,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useState } from "react";

// Mock data — replace with Convex action call
const MOCK_BILLINGS: Record<string, any> = {
  "1": {
    id: "1",
    cliente_id: "123",
    cliente_nome: "João Silva",
    competencia: "06/2026",
    vencimento: "15/07/2026",
    valor: 129.90,
    status: "pendente",
    linha_digitavel: "34191.79001 01043.510047 91020.150008 7 85620000012990",
    codigo_barras: "34197856200000129901790010104351004791020150",
    pix_copiaecola: "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266141740005204000053039865802BR5913Fulano de Tal6009SAOPAULO62070503***63041D3F",
    url_boleto: "#",
    multa: 2.60,
    juros: 0.06,
    nosso_numero: "123456789-0",
    observacoes: "Fatura referente ao plano Internet 300MB",
  },
  "2": {
    id: "2",
    cliente_id: "123",
    cliente_nome: "João Silva",
    competencia: "05/2026",
    vencimento: "15/06/2026",
    valor: 129.90,
    status: "pago",
    data_pagamento: "10/06/2026",
    valor_pago: 129.90,
    nosso_numero: "123456788-1",
  },
};

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pendente: { label: "Pendente", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400", icon: Clock },
  pago: { label: "Pago", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400", icon: CheckCircle2 },
  vencido: { label: "Vencido", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400", icon: AlertCircle },
  cancelado: { label: "Cancelado", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400", icon: AlertCircle },
};

export default function InvoiceDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const billing = MOCK_BILLINGS[id || ""];

  if (!billing) {
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
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
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
            <p className="text-sm text-muted-foreground mt-1">
              Nosso número: {billing.nosso_numero || "—"}
            </p>
          </div>

          <p className="text-2xl font-light tracking-tight text-foreground">
            {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Payment Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
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

              {billing.observacoes && (
                <>
                  <Separator />
                  <div className="text-sm">
                    <span className="text-muted-foreground block">Observações</span>
                    <span className="text-foreground text-xs">{billing.observacoes}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Actions Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
        >
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
                          onClick={() => handleCopy(billing.linha_digitavel, "linha")}
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

                  {billing.codigo_barras && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Código de Barras
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[10px] font-mono text-foreground bg-secondary/50 px-2 py-1.5 rounded-sm truncate">
                          {billing.codigo_barras}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopy(billing.codigo_barras, "barcode")}
                        >
                          {copiedField === "barcode" ? (
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
                          onClick={() => handleCopy(billing.pix_copiaecola, "pix")}
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
                      onClick={() => handleCopy(billing.linha_digitavel || billing.codigo_barras, "all")}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      Copiar dados
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 text-xs h-9"
                      onClick={() => {
                        // Download PDF — replace with actual download
                        if (billing.url_boleto) {
                          window.open(billing.url_boleto, "_blank");
                        }
                      }}
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
        </motion.div>
      </div>

      {/* Fine/Juros for overdue */}
      {billing.status === "pendente" && (billing.multa || billing.juros) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Encargos por Atraso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block">Multa</span>
                  <span className="text-foreground font-medium">
                    {billing.multa?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Juros por dia</span>
                  <span className="text-foreground font-medium">
                    {billing.juros?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
