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
  CheckCircle2,
  Loader2,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useBillings } from "@/hooks/use-billings";
import { useAuth } from "@/lib/auth-context";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusConfig } from "@/lib/status-config";

export default function InvoiceDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { billings, isLoading } = useBillings();
  const { customer } = useAuth();
  const [copiedField, handleCopy] = useCopyToClipboard();

  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const rawBilling = billings.find((b) => b.id === id);

  // Generate QR code from PIX copy-paste code
  useEffect(() => {
    if (!rawBilling?.pix_copiaecola) {
      setPixQrCode(null);
      return;
    }

    let cancelled = false;
    setQrLoading(true);

    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(rawBilling.pix_copiaecola!, {
        width: 280,
        margin: 2,
        color: {
          dark: "#0a0a0a",
          light: "#ffffff",
        },
      }).then((url: string) => {
        if (!cancelled) {
          setPixQrCode(url);
          setQrLoading(false);
        }
      }).catch(() => {
        if (!cancelled) setQrLoading(false);
      });
    }).catch(() => {
      if (!cancelled) setQrLoading(false);
    });

    return () => { cancelled = true; };
  }, [rawBilling?.pix_copiaecola]);

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
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-medium tracking-tight text-foreground">
                Fatura {billing.competencia}
              </h1>
              <Badge
                variant="outline"
                className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color} shrink-0`}
              >
                <StatusIcon className="h-3 w-3 mr-1" />
                {status.label}
              </Badge>
            </div>
          </div>

          <p className="text-xl sm:text-2xl font-light tracking-tight text-foreground">
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
              {(billing.status === "pendente" || billing.status === "vencido") && (
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
                    <div className="space-y-3">
                      {/* QR Code */}
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium self-start">
                          PIX QR Code
                        </p>
                        <div className="bg-white rounded-lg p-2 shadow-sm border border-border/50">
                          {qrLoading ? (
                            <div className="w-[140px] h-[140px] flex items-center justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : pixQrCode ? (
                            <img
                              src={pixQrCode}
                              alt="QR Code PIX"
                              className="w-[140px] h-[140px]"
                              width={140}
                              height={140}
                            />
                          ) : (
                            <div className="w-[140px] h-[140px] flex items-center justify-center">
                              <Smartphone className="h-6 w-6 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center leading-relaxed max-w-[200px]">
                          Abra o app do seu banco, escolha PIX e escaneie este código
                        </p>
                      </div>

                      {/* Copy-paste code */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                          PIX Copia e Cola
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[10px] font-mono text-foreground bg-secondary/50 px-2 py-1.5 rounded-sm line-clamp-2 break-all">
                            {billing.pix_copiaecola}
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
                    </div>
                  )}

                  {(billing.linha_digitavel || billing.pix_copiaecola) && <Separator />}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-9"
                      onClick={() => handleCopy(billing.linha_digitavel || billing.pix_copiaecola || "", "all")}
                      disabled={!billing.linha_digitavel && !billing.pix_copiaecola}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      {billing.linha_digitavel ? "Copiar linha" : "Copiar PIX"}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 text-xs h-9"
                      onClick={() => {
                        if (billing.url_boleto) {
                          window.open(billing.url_boleto, "_blank");
                        }
                      }}
                      disabled={!billing.url_boleto}
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
