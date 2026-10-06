/**
 * AdminDispatchDialog — Execução imediata da fila outbox (notify-dispatch).
 *
 * Permite visualizar o estado da fila (pendentes, entregues, erros), checar as cotas
 * de novas conversas e a janela horária, e disparar o envio imediato escolhendo o
 * tamanho do lote (limit) e a política (manual para ignorar janela / cota de cliente,
 * ou automatizada respeitando as regras estritas).
 *
 * Exibe o resumo do disparo detalhado: mensagens enviadas, adiadas por falta de cota,
 * falhas e itens processados.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  Sliders,
  Zap,
} from "lucide-react";
import { adminFetchHeader as adminFetch } from "@/lib/api-config";
import { plural } from "@/lib/plural";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ---------------------------------------------------------------------------
// Autenticação admin — consolidada em src/lib/api-config.ts. Este dialog sempre
// enviou o token TAMBÉM no header x-admin-token (variante adminFetchHeader).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tipos de Resposta (espelho de index.ts e dispatch.ts)
// ---------------------------------------------------------------------------

export interface DispatchItemResult {
  deliveryId: string;
  customerId: string | null;
  target: string;
  ok: boolean;
  status: string;
  reason: string;
}

export interface NewChatQuotaSummary {
  cap: number;
  started: number;
  heldByCap: number;
  usedToday: number;
  error?: string;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  released: number;
  failed: number;
  skipped: number;
  uncertain: number;
  paused: boolean;
  pauseReason?: string;
  newChats: NewChatQuotaSummary | null;
  results: DispatchItemResult[];
}

export interface DeliveryRow {
  id: string;
  eventId: string;
  channel: "whatsapp" | "push";
  customerId: string | null;
  cpf: string | null;
  target: string;
  status: "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped" | "canceled";
  attempts: number;
  scheduledFor: number;
  createdAt: number;
  providerId: string | null;
  errorKey: string | null;
  errorMessage: string | null;
  sentAt: number | null;
  statusAt: number | null;
}

export interface DeliveriesApiResponse {
  deliveries: DeliveryRow[];
  stats: Record<string, number>;
  migrationPending: boolean;
  error?: string;
}

export interface WhatsAppConfigData {
  baseUrl: string;
  instanceName: string | null;
  enabled: boolean;
  dailyNewChatCap: number;
  perCustomerCap: number;
  windowStart: number;
  windowEnd: number;
  pausedUntil: number | null;
  lastStatus: string | null;
  instance: { state: string; connected: boolean } | null;
  limits?: {
    newChatStatus: string | null;
    newChatUsed: number | null;
    newChatTotal: number | null;
    timeLockUntil: number | null;
  } | null;
  stats?: Record<string, number>;
}

export interface AdminDispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatchCompleted?: (summary: DispatchSummary) => void;
}

export function AdminDispatchDialog({
  open,
  onOpenChange,
  onDispatchCompleted,
}: AdminDispatchDialogProps) {
  // Configurações do disparo
  const [limit, setLimit] = useState<number>(10);
  const [channel, setChannel] = useState<"whatsapp" | "push">("whatsapp");
  const [policy, setPolicy] = useState<"manual" | "automated">("manual");

  // Estados de dados
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  // Confirmação antes do disparo (risco moderado: envia WhatsApp real ao cliente)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deliveriesData, setDeliveriesData] = useState<DeliveriesApiResponse | null>(null);
  const [waConfig, setWaConfig] = useState<WhatsAppConfigData | null>(null);
  const [lastSummary, setLastSummary] = useState<DispatchSummary | null>(null);

  // Carrega status da fila e configuração
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [delivRes, confRes] = await Promise.all([
        adminFetch("/api/admin/notifications/deliveries?limit=50"),
        adminFetch("/api/admin/whatsapp/config"),
      ]);

      if (delivRes.ok) {
        const dData = (await delivRes.json()) as DeliveriesApiResponse;
        setDeliveriesData(dData);
      }
      if (confRes.ok) {
        const cData = (await confRes.json()) as WhatsAppConfigData;
        setWaConfig(cData);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao carregar status da fila outbox."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadStatus();
    }
  }, [open, loadStatus]);

  // Contagens rápidas da fila
  const queueStats = useMemo(() => {
    const stats = deliveriesData?.stats ?? {};
    const queuedTotal = stats["queued"] ?? 0;
    const queuedWhatsApp = stats["whatsapp:queued"] ?? 0;
    const sentTotal = (stats["sent"] ?? 0) + (stats["delivered"] ?? 0) + (stats["read"] ?? 0);
    const failedTotal = stats["failed"] ?? 0;

    return {
      queued: queuedTotal,
      queuedWhatsApp,
      sent: sentTotal,
      failed: failedTotal,
    };
  }, [deliveriesData]);

  // Checagem de janela horária
  const windowCheck = useMemo(() => {
    if (!waConfig) return { inWindow: true, currentHour: new Date().getHours() };
    const currentHour = new Date().getHours();
    const start = waConfig.windowStart ?? 9;
    const end = waConfig.windowEnd ?? 20;
    const inWindow = currentHour >= start && currentHour < end;
    return { inWindow, currentHour, start, end };
  }, [waConfig]);

  // Disparo imediato da fila
  const handleDispatch = async () => {
    setDispatching(true);
    setError(null);
    try {
      const res = await adminFetch("/api/cron/notify-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          channel,
          policy,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao processar envio da fila outbox.");
      }

      const summary = data as DispatchSummary;
      setLastSummary(summary);
      onDispatchCompleted?.(summary);

      if (summary.sent > 0) {
        toast.success(
          `Disparo concluído: ${plural(summary.sent, "mensagem enviada", "mensagens enviadas")} com sucesso!`
        );
      } else if (summary.paused) {
        toast.warning(
          `Canal pausado: ${summary.pauseReason || "envio não pôde ser realizado."}`
        );
      } else if (summary.released > 0) {
        toast.info(
          `${plural(summary.released, "item reagendado", "itens reagendados")} (cota diária de novas conversas ou cliente).`
        );
      } else if (summary.claimed === 0) {
        toast.info("Nenhuma notificação pendente para envio no canal.");
      }

      // Atualiza os dados da fila após o disparo
      void loadStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao acionar notify-dispatch.";
      setError(msg);
      toast.error(msg);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden gap-0">
        {/* Cabeçalho */}
        <DialogHeader className="p-4 sm:p-5 border-b border-border shrink-0 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-emerald-600/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Envio Imediato da Fila (Notify Dispatch)
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Drena a outbox enviando mensagens diretamente pelo canal configurado.
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => void loadStatus()}
              disabled={loading || dispatching}
              title="Recarregar status da fila"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </DialogHeader>

        {/* Corpo com scroll */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900 text-xs text-red-800 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <div className="space-y-0.5">
                <p className="font-semibold">Erro</p>
                <p className="text-xs leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* Cards de Estado da Fila */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Card className="border-border shadow-none bg-card">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Na Fila (Queued)</span>
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">
                  {queueStats.queued}
                </p>
                <p className="text-xs text-muted-foreground">
                  {queueStats.queuedWhatsApp} no WhatsApp
                </p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-none bg-card">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Enviados (7d)</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {queueStats.sent}
                </p>
                <p className="text-xs text-muted-foreground">Sucesso de entrega</p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-none bg-card">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Falhas (7d)</span>
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-red-600 dark:text-red-400">
                  {queueStats.failed}
                </p>
                <p className="text-xs text-muted-foreground">Tentativas esgotadas</p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-none bg-card">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Cota Novas/Dia</span>
                  <ShieldAlert className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-foreground">
                  {waConfig?.dailyNewChatCap ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {waConfig?.limits?.newChatUsed !== undefined && waConfig?.limits?.newChatUsed !== null
                    ? `${waConfig.limits.newChatUsed} usadas hoje`
                    : "Teto diário anti-bloqueio"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Status do Canal WhatsApp */}
          <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-600" />
                <span className="font-medium text-foreground">Status do Provedor WhatsApp:</span>
                {waConfig ? (
                  waConfig.instance?.connected ? (
                    <Badge variant="outline" className="text-emerald-700 bg-emerald-500/10 border-emerald-500/30 text-xs">
                      Conectado ({waConfig.instance.state})
                    </Badge>
                  ) : waConfig.enabled ? (
                    <Badge variant="outline" className="text-amber-700 bg-amber-500/10 border-amber-500/30 text-xs">
                      Desconectado / Aguardando QR
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-xs">
                      Canal desativado
                    </Badge>
                  )
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-xs">
                    Carregando...
                  </Badge>
                )}
              </div>

              {waConfig?.pausedUntil ? (
                <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10 text-xs gap-1">
                  <Lock className="h-3 w-3" />
                  Time-lock até {new Date(Number(waConfig.pausedUntil)).toLocaleTimeString("pt-BR")}
                </Badge>
              ) : null}
            </div>

            {/* Aviso de Janela Horária */}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/60 text-muted-foreground">
              <span>
                Janela de envio: <strong>{windowCheck.start ?? 9}h às {windowCheck.end ?? 20}h</strong> (agora: {windowCheck.currentHour}h)
              </span>
              {!windowCheck.inWindow && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Fora da janela (envio automatizado pausará)
                </span>
              )}
            </div>
          </div>

          {/* Configuração do Lote a Disparar */}
          <div className="p-3.5 rounded-lg border border-border bg-card space-y-3">
            <h4 className="font-medium text-foreground flex items-center gap-1.5 text-xs">
              <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
              Parâmetros de Execução do Lote
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Tamanho do Lote */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Tamanho do Lote (limit)</label>
                <div className="flex gap-1.5">
                  {[10, 25, 50].map((size) => (
                    <Button
                      key={size}
                      type="button"
                      variant={limit === size ? "default" : "outline"}
                      size="sm"
                      className={`h-8 flex-1 text-xs font-mono ${
                        limit === size ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                      }`}
                      onClick={() => setLimit(size)}
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Canal */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Canal de Envio</label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant={channel === "whatsapp" ? "default" : "outline"}
                    size="sm"
                    className={`h-8 flex-1 text-xs ${
                      channel === "whatsapp" ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                    }`}
                    onClick={() => setChannel("whatsapp")}
                  >
                    WhatsApp
                  </Button>
                  <Button
                    type="button"
                    variant={channel === "push" ? "default" : "outline"}
                    size="sm"
                    className={`h-8 flex-1 text-xs ${
                      channel === "push" ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                    }`}
                    onClick={() => setChannel("push")}
                  >
                    Push
                  </Button>
                </div>
              </div>

              {/* Política (Manual vs Automatizada) */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Modo de Envio (policy)</label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant={policy === "manual" ? "default" : "outline"}
                    size="sm"
                    className={`h-8 flex-1 text-xs ${
                      policy === "manual" ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                    }`}
                    onClick={() => setPolicy("manual")}
                    title="Ignora janela horária e limite de 1 aviso/cliente/dia. Respeita cota de novas conversas."
                  >
                    Manual
                  </Button>
                  <Button
                    type="button"
                    variant={policy === "automated" ? "default" : "outline"}
                    size="sm"
                    className={`h-8 flex-1 text-xs ${
                      policy === "automated" ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                    }`}
                    onClick={() => setPolicy("automated")}
                    title="Respeita estritamente janela horária e limite por cliente."
                  >
                    Automático
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {policy === "manual" ? (
                <span>
                  <strong>Modo Manual:</strong> Força o envio agora, ignorando a restrição de horário comercial e limite por cliente. A cota diária de <em>novas conversas</em> continua rigorosamente ativa para proteger seu número.
                </span>
              ) : (
                <span>
                  <strong>Modo Automático:</strong> Simula a mesma rotina do cron agendado. Mensagens fora do horário comercial são ignoradas e permanecem na fila para o horário permitido.
                </span>
              )}
            </p>
          </div>

          {/* Resultado do Último Disparo */}
          {lastSummary && (
            <div className="space-y-2.5 p-3.5 rounded-lg border border-border bg-muted/20">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                  <Zap className="h-3.5 w-3.5 text-emerald-600" />
                  Resultado da Drenagem
                </h4>
                {lastSummary.paused && (
                  <Badge variant="outline" className="text-amber-700 bg-amber-500/10 border-amber-500/30 text-xs gap-1">
                    <PauseCircle className="h-3 w-3" />
                    Canal pausou: {lastSummary.pauseReason}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                <div className="p-2 rounded bg-card border border-border">
                  <span className="text-xs text-muted-foreground block">Reservados</span>
                  <strong className="text-base font-semibold">{lastSummary.claimed}</strong>
                </div>
                <div className="p-2 rounded bg-card border border-border">
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 block">Enviados</span>
                  <strong className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                    {lastSummary.sent}
                  </strong>
                </div>
                <div className="p-2 rounded bg-card border border-border">
                  <span className="text-xs text-amber-600 dark:text-amber-400 block">Reagendados</span>
                  <strong className="text-base font-semibold text-amber-600 dark:text-amber-400">
                    {lastSummary.released}
                  </strong>
                </div>
                <div className="p-2 rounded bg-card border border-border">
                  <span className="text-xs text-red-600 dark:text-red-400 block">Falhas</span>
                  <strong className="text-base font-semibold text-red-600 dark:text-red-400">
                    {lastSummary.failed}
                  </strong>
                </div>
                <div className="p-2 rounded bg-card border border-border">
                  <span className="text-xs text-muted-foreground block">Descartados</span>
                  <strong className="text-base font-semibold text-muted-foreground">
                    {lastSummary.skipped}
                  </strong>
                </div>
              </div>

              {/* Informação sobre novas conversas consumidas */}
              {lastSummary.newChats && (
                <div className="text-xs p-2.5 rounded bg-card border border-border text-muted-foreground space-y-1">
                  <div className="flex items-center justify-between text-foreground font-medium">
                    <span>Consumo de Cotas de Novas Conversas (Hoje):</span>
                    <span>
                      {lastSummary.newChats.usedToday} / {lastSummary.newChats.cap} usadas
                    </span>
                  </div>
                  <p className="text-xs">
                    Conversas iniciadas neste lote: <strong>{lastSummary.newChats.started}</strong> ·
                    Retidas por teto de cota (reagendadas): <strong>{lastSummary.newChats.heldByCap}</strong>
                  </p>
                </div>
              )}

              {/* Lista dos itens disparados */}
              {lastSummary.results.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-medium text-foreground">
                    Itens processados neste disparo:
                  </span>
                  <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-xs border border-border rounded p-1.5 bg-background">
                    {lastSummary.results.map((res, i) => (
                      <div
                        key={res.deliveryId || i}
                        className="flex items-center justify-between gap-2 p-1 rounded hover:bg-muted/40"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {res.ok ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                          ) : (
                            <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                          )}
                          <span className="truncate">{res.target}</span>
                        </div>
                        <span
                          className={`shrink-0 ${
                            res.ok
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          {res.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Amostra das entregas pendentes na fila */}
          {deliveriesData && deliveriesData.deliveries.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  Avisos mais recentes no Outbox:
                </span>
                <span className="text-xs text-muted-foreground">
                  Mostrando {Math.min(deliveriesData.deliveries.length, 50)} registros
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border/60 bg-card">
                {deliveriesData.deliveries.slice(0, 10).map((row) => (
                  <div
                    key={row.id}
                    className="p-2 flex items-center justify-between gap-2 text-xs hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 h-4 uppercase ${
                          row.status === "sent" || row.status === "delivered"
                            ? "border-emerald-500/40 text-emerald-600"
                            : row.status === "queued"
                            ? "border-amber-500/40 text-amber-600"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {row.status}
                      </Badge>
                      <span className="font-mono text-xs text-foreground">{row.target}</span>
                      <span className="text-xs text-muted-foreground">({row.channel})</span>
                    </div>

                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      {row.attempts > 0
                        ? plural(row.attempts, "tentativa", "tentativas")
                        : "Aguardando envio"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <DialogFooter className="p-4 border-t border-border shrink-0 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {queueStats.queued > 0 ? (
              <span>
                <strong>{queueStats.queued}</strong>{" "}
                {queueStats.queued === 1
                  ? "item aguardando disparo"
                  : "itens aguardando disparo"}{" "}
                na fila.
              </span>
            ) : (
              <span>Fila outbox vazia no momento.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>

            <Button
              size="sm"
              className="text-xs h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
              disabled={Boolean(dispatching || loading || (waConfig && !waConfig.enabled && channel === "whatsapp"))}
              onClick={() => setConfirmOpen(true)}
            >
              {dispatching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Drenando fila ({limit})...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Disparar lote agora ({limit})
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Confirmação de disparo — o envio é real e chega ao cliente. */}
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={`Disparar ${plural(Math.min(limit, queueStats.queued), "mensagem", "mensagens")} agora?`}
      description="O envio sai imediatamente pelos canais configurados, sem esperar o cron."
      confirmLabel="Disparar agora"
      actionClassName="bg-emerald-600 hover:bg-emerald-700 text-white"
      disabled={dispatching || queueStats.queued === 0}
      onConfirm={async () => {
        // O diálogo fica aberto durante o envio (spinner + bloqueio do
        // ConfirmDialog). Só fecha no fim: se falhar, o usuário cai no diálogo
        // pai, que mostra o erro — fechar antes esconderia os dois.
        try {
          await handleDispatch();
        } finally {
          setConfirmOpen(false);
        }
      }}
    >
      <dl className="rounded-sm border border-border bg-secondary/40 divide-y divide-border/60 text-xs">
        <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
          <dt className="text-muted-foreground">Aguardando na fila</dt>
          <dd className="font-medium">
            {plural(queueStats.queued, "item", "itens")} · {queueStats.queuedWhatsApp} no WhatsApp
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
          <dt className="text-muted-foreground">Lote</dt>
          <dd>até {limit} por execução</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
          <dt className="text-muted-foreground">Política</dt>
          <dd>
            {policy === "manual"
              ? "Manual — ignora horário comercial"
              : "Automático — respeita janela e cotas"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
          <dt className="text-muted-foreground">Janela de envio</dt>
          <dd className={windowCheck.inWindow ? "" : "text-amber-600 dark:text-amber-400"}>
            {windowCheck.inWindow
              ? "dentro da janela"
              : `fora da janela (${windowCheck.start}h–${windowCheck.end}h)`}
          </dd>
        </div>
      </dl>
      {queueStats.queued === 0 ? (
        <p className="text-destructive">A fila está vazia — não há nada para disparar.</p>
      ) : (
        <p className="text-muted-foreground">
          As mensagens são enviadas como estão na fila. Falhas voltam para &quot;falhou&quot; e podem ser
          reprocessadas na tela de Mensagens.
        </p>
      )}
    </ConfirmDialog>
    </>
  );
}
