/**
 * AdminOutbox — Tela de monitoramento em tempo real da fila outbox de notificações.
 *
 * Permite inspecionar todas as mensagens na fila e histórico com:
 * - Filtros por status (queued, sending, sent, delivered, read, failed, skipped, canceled)
 * - Filtros por canal (whatsapp, push)
 * - Busca textual por telefone (target), ID do cliente, CPF ou mensagem de erro
 * - Polling em tempo real com toggle (5s, 10s, 30s ou desligado)
 * - Ações em lote e individuais:
 *    * Seleção por checkbox (individual ou selecionar tudo)
 *    * Reenviar falhas (retry): reseta tentativas para 0, agenda para agora e dispara
 *    * Cancelar pendentes (cancel): altera status para canceled
 * - Botões de ação rápida para disparar lote imediato (AdminDispatchDialog) e sincronizar cobranças (AdminSyncDialog)
 * - Inspeção do payload renderizado e detalhes técnicos de cada entrega.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  Layers,
  Loader2,
  MessageSquare,
  PauseCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  User,
  XCircle,
  Radio,
  CheckSquare,
  Square,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminSyncDialog } from "@/components/AdminSyncDialog";
import { AdminDispatchDialog } from "@/components/AdminDispatchDialog";
import { apiUrl } from "@/lib/api-config";

// ---------------------------------------------------------------------------
// Helpers e Tipos
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function withAdminToken(url: string): string {
  const token = getAdminToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

async function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-admin-token", token);
  return fetch(withAdminToken(apiUrl(url)), {
    ...init,
    headers,
    credentials: "include",
  });
}

export type DeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped"
  | "canceled";

export interface OutboxDelivery {
  id: string;
  eventId: string;
  channel: "whatsapp" | "push";
  customerId: string | null;
  cpf: string | null;
  target: string;
  rendered: { title?: string; body?: string; url?: string } | null;
  status: DeliveryStatus;
  attempts: number;
  scheduledFor: number;
  providerId: string | null;
  errorKey: string | null;
  errorMessage: string | null;
  sentAt: number | null;
  statusAt: number | null;
  createdAt: number;
}

interface OutboxApiResponse {
  deliveries: OutboxDelivery[];
  stats: Record<string, number>;
  migrationPending: boolean;
  error?: string;
}

function formatEpochTime(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatCpfMask(cpf: string | null | undefined): string {
  if (!cpf) return "—";
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return cpf;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
}

const STATUS_CONFIG: Record<
  DeliveryStatus,
  { label: string; bg: string; text: string; border: string; icon: typeof Clock }
> = {
  queued: {
    label: "Aguardando (queued)",
    bg: "bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-500/30",
    icon: Clock,
  },
  sending: {
    label: "Enviando (sending)",
    bg: "bg-blue-500/10",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-500/30",
    icon: Loader2,
  },
  sent: {
    label: "Enviado (sent)",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-500/30",
    icon: CheckCircle2,
  },
  delivered: {
    label: "Entregue (delivered)",
    bg: "bg-teal-500/10",
    text: "text-teal-700 dark:text-teal-400",
    border: "border-teal-500/30",
    icon: CheckCircle2,
  },
  read: {
    label: "Lido (read)",
    bg: "bg-sky-500/10",
    text: "text-sky-700 dark:text-sky-400",
    border: "border-sky-500/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Falhou (failed)",
    bg: "bg-red-500/10",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-500/30",
    icon: AlertCircle,
  },
  skipped: {
    label: "Descartado (skipped)",
    bg: "bg-muted/40",
    text: "text-muted-foreground",
    border: "border-border",
    icon: PauseCircle,
  },
  canceled: {
    label: "Cancelado",
    bg: "bg-muted/40",
    text: "text-muted-foreground",
    border: "border-border",
    icon: XCircle,
  },
};

export default function AdminOutbox() {
  const navigate = useNavigate();

  // Estados principais
  const [deliveries, setDeliveries] = useState<OutboxDelivery[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [migrationPending, setMigrationPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState<number>(100);

  // Polling em tempo real
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10); // segundos
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());

  // Seleção em lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Confirmações modais
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [targetRetryIds, setTargetRetryIds] = useState<string[]>([]);
  const [targetCancelIds, setTargetCancelIds] = useState<string[]>([]);

  // Diálogos modais
  const [syncOpen, setSyncOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<OutboxDelivery | null>(null);

  // Carrega entregas
  const loadDeliveries = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      params.set("limit", String(limit));

      const res = await adminFetch(`/api/admin/notifications/deliveries?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401) {
          navigate("/admin");
          return;
        }
        throw new Error(`Erro HTTP ${res.status}`);
      }

      const data = (await res.json()) as OutboxApiResponse;
      setDeliveries(data.deliveries || []);
      setStats(data.stats || {});
      setMigrationPending(Boolean(data.migrationPending));
      setLastRefreshedAt(Date.now());
    } catch (err) {
      if (!isSilent) {
        setError(err instanceof Error ? err.message : "Falha ao consultar fila de notificações.");
      }
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [statusFilter, searchQuery, limit, navigate]);

  // Carregamento inicial e ao mudar filtros
  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  // Polling automático
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      void loadDeliveries(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, loadDeliveries]);

  // Filtro adicional no cliente (caso canal seja filtrado)
  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((item) => {
      if (channelFilter !== "all" && item.channel !== channelFilter) return false;
      return true;
    });
  }, [deliveries, channelFilter]);

  // Limpa seleções inválidas quando a lista mudar
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      const existing = new Set(filteredDeliveries.map((d) => d.id));
      for (const id of prev) {
        if (existing.has(id)) next.add(id);
      }
      return next;
    });
  }, [filteredDeliveries]);

  // Métricas agregadas
  const metrics = useMemo(() => {
    const queued = stats["queued"] ?? 0;
    const sent = (stats["sent"] ?? 0) + (stats["delivered"] ?? 0) + (stats["read"] ?? 0);
    const read = stats["read"] ?? 0;
    const failed = stats["failed"] ?? 0;
    const skipped = stats["skipped"] ?? 0;

    return { queued, sent, read, failed, skipped };
  }, [stats]);

  // Contagem de selecionados por tipo
  const selectedDetails = useMemo(() => {
    const selectedList = filteredDeliveries.filter((d) => selectedIds.has(d.id));
    const failedCount = selectedList.filter((d) => d.status === "failed").length;
    const queuedCount = selectedList.filter((d) => d.status === "queued").length;
    return {
      total: selectedList.length,
      failedCount,
      queuedCount,
      items: selectedList,
    };
  }, [filteredDeliveries, selectedIds]);

  // Alterna seleção individual
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Selecionar todos os visíveis
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDeliveries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDeliveries.map((d) => d.id)));
    }
  };

  // Ação de Retry
  const executeRetry = async (ids: string[]) => {
    setBulkActionLoading(true);
    try {
      const res = await adminFetch("/api/admin/notifications/deliveries/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          dispatchNow: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao reenviar mensagens.");
      }

      toast.success(
        `${ids.length} entrega(s) reenviada(s) com sucesso para processamento imediato.`
      );
      setSelectedIds(new Set());
      void loadDeliveries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar retry.");
    } finally {
      setBulkActionLoading(false);
      setRetryDialogOpen(false);
    }
  };

  // Ação de Cancelamento
  const executeCancel = async (ids: string[]) => {
    setBulkActionLoading(true);
    try {
      const res = await adminFetch("/api/admin/notifications/deliveries/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          reason: "Cancelamento em lote pelo painel admin",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao cancelar mensagens.");
      }

      toast.success(`${ids.length} mensagem(ns) pendente(s) cancelada(s).`);
      setSelectedIds(new Set());
      void loadDeliveries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar mensagens.");
    } finally {
      setBulkActionLoading(false);
      setCancelDialogOpen(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 animate-[fadeIn_0.2s_ease-out]">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium tracking-tight text-foreground">
              Monitoramento da Fila Outbox
            </h1>
            <Badge
              variant="outline"
              className={`text-[10px] gap-1 px-2 py-0.5 ${
                autoRefreshInterval > 0
                  ? "border-emerald-500/40 text-emerald-700 bg-emerald-500/10"
                  : "border-border text-muted-foreground"
              }`}
            >
              <Radio className={`h-3 w-3 ${autoRefreshInterval > 0 ? "text-emerald-500 animate-pulse" : ""}`} />
              {autoRefreshInterval > 0 ? `Ao vivo (${autoRefreshInterval}s)` : "Pausado"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Acompanhe em tempo real as mensagens na fila, histórico de envios, confirmações de leitura e retries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Controle de polling */}
          <Select
            value={String(autoRefreshInterval)}
            onValueChange={(val) => setAutoRefreshInterval(Number(val))}
          >
            <SelectTrigger className="h-9 text-xs w-[130px]">
              <SelectValue placeholder="Atualização" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">Atualizar a cada 5s</SelectItem>
              <SelectItem value="10">Atualizar a cada 10s</SelectItem>
              <SelectItem value="30">Atualizar a cada 30s</SelectItem>
              <SelectItem value="0">Desativar polling</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9 gap-1.5 cursor-pointer"
            onClick={() => void loadDeliveries()}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Recarregar
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
            onClick={() => setSyncOpen(true)}
          >
            <Layers className="h-3.5 w-3.5" />
            Sincronizar cobranças
          </Button>

          <Button
            size="sm"
            className="text-xs h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer font-medium"
            onClick={() => setDispatchOpen(true)}
          >
            <Send className="h-3.5 w-3.5" />
            Disparar lote agora
          </Button>
        </div>
      </div>

      {migrationPending && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-sm">Migration 003 de Notificações Pendente</p>
            <p className="leading-relaxed">
              A tabela de outbox (<code className="font-mono">notification_deliveries</code>) ainda não foi criada no banco de dados Supabase. Execute a migration 003 no SQL Editor do Supabase para ativar a gravação da fila e histórico.
            </p>
          </div>
        </div>
      )}

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-border shadow-none bg-card">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-medium">Aguardando Envio</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">
              {metrics.queued}
            </p>
            <p className="text-[10px] text-muted-foreground">Na fila outbox</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-medium">Enviados (7d)</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
              {metrics.sent}
            </p>
            <p className="text-[10px] text-muted-foreground">Despachados com sucesso</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-medium">Lidos (read)</span>
              <Eye className="h-4 w-4 text-sky-500" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-sky-600 dark:text-sky-400">
              {metrics.read}
            </p>
            <p className="text-[10px] text-muted-foreground">Confirmação de leitura</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-medium">Falhas (7d)</span>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-red-600 dark:text-red-400">
              {metrics.failed}
            </p>
            <p className="text-[10px] text-muted-foreground">Tentativas esgotadas</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-medium">Descartados</span>
              <PauseCircle className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-muted-foreground">
              {metrics.skipped}
            </p>
            <p className="text-[10px] text-muted-foreground">Sem template/evento</p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Filtros e Busca */}
      <Card className="border-border shadow-none bg-card">
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row items-center gap-3">
            {/* Campo de Busca */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por telefone, ID do cliente, CPF ou erro..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Filtro de Status */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs w-[170px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="queued">Aguardando (queued)</SelectItem>
                  <SelectItem value="sending">Enviando (sending)</SelectItem>
                  <SelectItem value="sent">Enviado (sent)</SelectItem>
                  <SelectItem value="delivered">Entregue (delivered)</SelectItem>
                  <SelectItem value="read">Lido (read)</SelectItem>
                  <SelectItem value="failed">Falha (failed)</SelectItem>
                  <SelectItem value="skipped">Descartado (skipped)</SelectItem>
                  <SelectItem value="canceled">Cancelado (canceled)</SelectItem>
                </SelectContent>
              </Select>

              {/* Filtro de Canal */}
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger className="h-9 text-xs w-[140px]">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="push">Push Web</SelectItem>
                </SelectContent>
              </Select>

              {/* Limite */}
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9 text-xs w-[110px]">
                  <SelectValue placeholder="Limite" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 itens</SelectItem>
                  <SelectItem value="100">100 itens</SelectItem>
                  <SelectItem value="250">250 itens</SelectItem>
                  <SelectItem value="500">500 itens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Barra de Ações em Lote quando há seleção */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-lg bg-muted/40 border border-border animate-[fadeIn_0.15s_ease-out]">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5">
                  {selectedIds.size} selecionado(s)
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  ({selectedDetails.failedCount} falha(s), {selectedDetails.queuedCount} pendente(s))
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                  onClick={() => {
                    setTargetRetryIds(Array.from(selectedIds));
                    setRetryDialogOpen(true);
                  }}
                  disabled={bulkActionLoading}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reenviar selecionadas ({selectedIds.size})
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 cursor-pointer"
                  onClick={() => {
                    const queuedOnly = Array.from(selectedIds).filter((id) => {
                      const item = deliveries.find((d) => d.id === id);
                      return item?.status === "queued";
                    });
                    if (queuedOnly.length === 0) {
                      toast.warning("Nenhuma das mensagens selecionadas está no status 'queued' (pendente).");
                      return;
                    }
                    setTargetCancelIds(queuedOnly);
                    setCancelDialogOpen(true);
                  }}
                  disabled={bulkActionLoading}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancelar pendentes ({selectedDetails.queuedCount})
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Limpar seleção
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista / Tabela da Outbox */}
      <Card className="border-border shadow-none overflow-hidden">
        <CardHeader className="p-4 border-b border-border bg-muted/10 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Registros da Outbox</CardTitle>
            <CardDescription className="text-xs">
              {filteredDeliveries.length} mensagem(ns) encontrada(s) · Última checagem às{" "}
              {new Date(lastRefreshedAt).toLocaleTimeString("pt-BR")}
            </CardDescription>
          </div>

          {/* Atalho para reprocessar todas as falhas visíveis */}
          {metrics.failed > 0 && selectedIds.size === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1 border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/10"
              onClick={() => {
                const failedIds = filteredDeliveries
                  .filter((d) => d.status === "failed")
                  .map((d) => d.id);
                if (failedIds.length > 0) {
                  setTargetRetryIds(failedIds);
                  setRetryDialogOpen(true);
                } else {
                  toast.info("Nenhuma mensagem com status 'failed' na listagem atual.");
                }
              }}
            >
              <RotateCcw className="h-3 w-3" />
              Reenviar todas as falhas
            </Button>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loading && deliveries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Consultando fila de entregas...</p>
            </div>
          ) : filteredDeliveries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
              <Layers className="h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Nenhuma notificação encontrada</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Não há registros com os filtros atuais. Experimente sincronizar novas faturas para popular a fila.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground text-[11px] font-medium">
                    <th className="py-2.5 px-3 w-10 text-center">
                      <Checkbox
                        checked={
                          filteredDeliveries.length > 0 &&
                          selectedIds.size === filteredDeliveries.length
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Selecionar tudo"
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Destino / Cliente</th>
                    <th className="py-2.5 px-4">Canal</th>
                    <th className="py-2.5 px-4">Tentativas</th>
                    <th className="py-2.5 px-4">Horário / Agendado</th>
                    <th className="py-2.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDeliveries.map((item) => {
                    const statusInfo = STATUS_CONFIG[item.status] || STATUS_CONFIG.queued;
                    const StatusIcon = statusInfo.icon;
                    const isSelected = selectedIds.has(item.id);

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? "bg-muted/60" : "hover:bg-muted/30"
                        }`}
                        onClick={() => setSelectedDelivery(item)}
                      >
                        {/* Checkbox de seleção */}
                        <td
                          className="py-3 px-3 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(item.id);
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(item.id)}
                            aria-label={`Selecionar ${item.target}`}
                            className="cursor-pointer"
                          />
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-medium gap-1 px-2 py-0.5 border ${statusInfo.border} ${statusInfo.bg} ${statusInfo.text}`}
                          >
                            <StatusIcon className={`h-3 w-3 ${item.status === "sending" ? "animate-spin" : ""}`} />
                            {statusInfo.label}
                          </Badge>
                          {item.errorMessage && (
                            <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 max-w-[200px] truncate" title={item.errorMessage}>
                              {item.errorMessage}
                            </p>
                          )}
                        </td>

                        {/* Destino e Cliente */}
                        <td className="py-3 px-4">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-mono font-medium text-foreground">
                              {item.channel === "whatsapp" ? (
                                <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                              ) : (
                                <Send className="h-3 w-3 text-blue-500 shrink-0" />
                              )}
                              <span>{item.target}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              {item.customerId && <span>ID: {item.customerId}</span>}
                              {item.cpf && <span>CPF: {formatCpfMask(item.cpf)}</span>}
                            </div>
                          </div>
                        </td>

                        {/* Canal */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge variant="outline" className="text-[10px] uppercase font-mono px-1.5 py-0">
                            {item.channel}
                          </Badge>
                        </td>

                        {/* Tentativas */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span className="font-mono text-foreground font-medium">
                              {item.attempts} / 4
                            </span>
                            {item.errorKey && (
                              <span className="block text-[10px] text-amber-600 font-mono">
                                {item.errorKey}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Horário */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span className="text-[11px] text-foreground font-medium">
                              {item.sentAt ? `Enviado: ${formatEpochTime(item.sentAt)}` : `Criado: ${formatEpochTime(item.createdAt)}`}
                            </span>
                            {item.status === "queued" && item.scheduledFor > 0 && (
                              <p className="text-[10px] text-muted-foreground">
                                Agendado: {formatEpochTime(item.scheduledFor)}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Ações individuais */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            {/* Reenviar se falhou ou foi descartada */}
                            {(item.status === "failed" || item.status === "canceled") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                onClick={() => {
                                  setTargetRetryIds([item.id]);
                                  setRetryDialogOpen(true);
                                }}
                                title="Reenviar agora"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Reenviar
                              </Button>
                            )}

                            {/* Cancelar se pendente na fila */}
                            {item.status === "queued" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => {
                                  setTargetCancelIds([item.id]);
                                  setCancelDialogOpen(true);
                                }}
                                title="Cancelar envio"
                              >
                                <Ban className="h-3 w-3" />
                                Cancelar
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => setSelectedDelivery(item)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Detalhes
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Detalhes da Notificação */}
      <Dialog open={!!selectedDelivery} onOpenChange={(open) => !open && setSelectedDelivery(null)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-0 overflow-hidden gap-0">
          <DialogHeader className="p-4 sm:p-5 border-b border-border shrink-0 bg-muted/20">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-600" />
              <DialogTitle className="text-base font-semibold">
                Detalhes da Entrega Outbox
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs font-mono text-muted-foreground">
              ID: {selectedDelivery?.id}
            </DialogDescription>
          </DialogHeader>

          {selectedDelivery && (
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Status e Canal */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-card">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Status Atual</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] mt-1 font-medium ${
                      STATUS_CONFIG[selectedDelivery.status]?.bg
                    } ${STATUS_CONFIG[selectedDelivery.status]?.text} ${
                      STATUS_CONFIG[selectedDelivery.status]?.border
                    }`}
                  >
                    {STATUS_CONFIG[selectedDelivery.status]?.label}
                  </Badge>
                </div>

                <div>
                  <span className="text-[10px] text-muted-foreground block">Canal</span>
                  <strong className="text-xs uppercase font-mono mt-1 block">
                    {selectedDelivery.channel}
                  </strong>
                </div>

                <div>
                  <span className="text-[10px] text-muted-foreground block">Destinatário</span>
                  <strong className="text-xs font-mono mt-1 block text-foreground">
                    {selectedDelivery.target}
                  </strong>
                </div>

                <div>
                  <span className="text-[10px] text-muted-foreground block">Cliente ID / CPF</span>
                  <span className="text-xs mt-1 block text-muted-foreground">
                    {selectedDelivery.customerId || "—"} / {formatCpfMask(selectedDelivery.cpf)}
                  </span>
                </div>
              </div>

              {/* Erro ou Falha */}
              {selectedDelivery.errorMessage && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <span>Erro no Envio ({selectedDelivery.errorKey || "ERRO"})</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{selectedDelivery.errorMessage}</p>
                </div>
              )}

              {/* Conteúdo Renderizado (Mensagem Real) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-foreground">
                  Mensagem Renderizada:
                </span>
                {selectedDelivery.rendered ? (
                  <div className="p-3.5 rounded-lg border border-border bg-muted/30 whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                    {selectedDelivery.rendered.title && (
                      <p className="font-semibold mb-1">{selectedDelivery.rendered.title}</p>
                    )}
                    <p>{selectedDelivery.rendered.body || "—"}</p>
                    {selectedDelivery.rendered.url && (
                      <a
                        href={selectedDelivery.rendered.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-600 hover:underline mt-2 text-[11px]"
                      >
                        Abrir link da fatura <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic text-[11px] p-3 border border-border rounded">
                    A mensagem ainda não foi renderizada (é processada no momento do disparo para calcular juros e dias de atraso corretos).
                  </p>
                )}
              </div>

              {/* Dados Técnicos / Auditoria */}
              <div className="space-y-1.5 pt-2">
                <span className="text-[11px] font-semibold text-foreground">Metadados Técnicos:</span>
                <div className="p-2.5 rounded border border-border bg-card font-mono text-[10px] space-y-1 text-muted-foreground">
                  <p>Event ID: {selectedDelivery.eventId}</p>
                  {selectedDelivery.providerId && <p>Provider ID: {selectedDelivery.providerId}</p>}
                  <p>Tentativas efetuadas: {selectedDelivery.attempts}</p>
                  <p>Criado em: {formatEpochTime(selectedDelivery.createdAt)}</p>
                  {selectedDelivery.sentAt && <p>Enviado em: {formatEpochTime(selectedDelivery.sentAt)}</p>}
                  {selectedDelivery.statusAt && <p>Status atualizado em: {formatEpochTime(selectedDelivery.statusAt)}</p>}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="p-4 border-t border-border shrink-0 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedDelivery && (selectedDelivery.status === "failed" || selectedDelivery.status === "canceled") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                  onClick={() => {
                    setTargetRetryIds([selectedDelivery.id]);
                    setRetryDialogOpen(true);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reenviar esta entrega
                </Button>
              )}

              {selectedDelivery && selectedDelivery.status === "queued" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 gap-1.5 border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 cursor-pointer"
                  onClick={() => {
                    setTargetCancelIds([selectedDelivery.id]);
                    setCancelDialogOpen(true);
                  }}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancelar envio
                </Button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setSelectedDelivery(null)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de Confirmação de Retry */}
      <ConfirmDialog
        open={retryDialogOpen}
        onOpenChange={setRetryDialogOpen}
        title={`Reenviar ${targetRetryIds.length} entrega(s)?`}
        description="O status voltará para 'queued', as tentativas serão zeradas e o envio imediato será acionado."
        confirmLabel="Confirmar e Reenviar"
        actionClassName="bg-emerald-600 hover:bg-emerald-700 text-white"
        disabled={bulkActionLoading}
        onConfirm={() => executeRetry(targetRetryIds)}
      >
        <p className="text-muted-foreground text-xs leading-relaxed">
          As entregas selecionadas serão reprocessadas respeitando as cotas de novas conversas do canal. Se o canal estiver dentro da janela ou em modo manual, o envio ocorre imediatamente.
        </p>
      </ConfirmDialog>

      {/* Diálogo de Confirmação de Cancelamento */}
      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={`Cancelar ${targetCancelIds.length} mensagem(ns) pendente(s)?`}
        description="As mensagens selecionadas sairão da fila de envio e não serão despachadas."
        confirmLabel="Confirmar Cancelamento"
        actionClassName="bg-red-600 hover:bg-red-700 text-white"
        disabled={bulkActionLoading}
        onConfirm={() => executeCancel(targetCancelIds)}
      >
        <p className="text-muted-foreground text-xs leading-relaxed">
          O status das entregas selecionadas mudará para <code className="font-mono">canceled</code>. Elas permanecerão no histórico para conferência do provedor, mas não sairão pelo WhatsApp nem Push.
        </p>
      </ConfirmDialog>

      {/* Diálogos Compartilhados */}
      <AdminSyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onSyncCompleted={() => void loadDeliveries()}
        onOpenDispatch={() => setDispatchOpen(true)}
      />

      <AdminDispatchDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDispatchCompleted={() => void loadDeliveries()}
      />
    </div>
  );
}
