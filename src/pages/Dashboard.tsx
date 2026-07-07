/**
 * Dashboard Page — Shows a summary of the customer's account,
 * including pending invoices, next due date, and quick actions.
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
import { motion } from "framer-motion";
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
import { useState, useEffect } from "react";

// Mock data for demonstration — replace with actual API calls
const MOCK_BILLINGS = [
  {
    id: "1",
    competencia: "06/2026",
    vencimento: "15/07/2026",
    valor: 129.90,
    status: "pendente" as const,
    linha_digitavel: "34191.79001 01043.510047 91020.150008 7 85620000012990",
    pix_copiaecola: "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266141740005204000053039865802BR5913Fulano de Tal6009SAOPAULO62070503***63041D3F",
  },
  {
    id: "2",
    competencia: "05/2026",
    vencimento: "15/06/2026",
    valor: 129.90,
    status: "pago" as const,
    data_pagamento: "10/06/2026",
    valor_pago: 129.90,
  },
  {
    id: "3",
    competencia: "04/2026",
    vencimento: "15/05/2026",
    valor: 129.90,
    status: "pago" as const,
    data_pagamento: "12/05/2026",
    valor_pago: 129.90,
  },
];

const statusConfig = {
  pendente: { label: "Pendente", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400", icon: Clock },
  pago: { label: "Pago", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400", icon: CheckCircle2 },
  vencido: { label: "Vencido", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400", icon: AlertCircle },
  cancelado: { label: "Cancelado", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400", icon: AlertCircle },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { customer } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pendingBillings = MOCK_BILLINGS.filter(b => b.status === "pendente");
  const pendingCount = pendingBillings.length;
  const pendingTotal = pendingBillings.reduce((sum, b) => sum + b.valor, 0);
  const nextDueDate = pendingBillings[0]?.vencimento;

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for older browsers
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
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
        >
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
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
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
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
        >
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
        </motion.div>
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
          {MOCK_BILLINGS.slice(0, 3).map((billing, index) => {
            const status = statusConfig[billing.status];
            const StatusIcon = status.icon;

            return (
              <motion.div
                key={billing.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * index, duration: 0.2 }}
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
                            // Download PDF
                          }}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          PDF
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
