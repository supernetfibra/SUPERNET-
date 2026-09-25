/**
 * AdminSyncDialog — Prévia e execução sob demanda do sync diário de cobranças.
 *
 * Dispara `GET /api/cron/notify-sync?dryRun=1` para inspecionar exatamente o que
 * entraria na fila hoje e por que cada aviso descartado ficaria de fora (sem opt-in,
 * duplicidade, telefone inválido, aguardando push, etc).
 *
 * Após conferir a prévia honesta, permite confirmar a gravação real (`dryRun=false`),
 * gravando os eventos no outbox para consumo pelo cron de envio (notify-dispatch).
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Send,
  Users,
  XCircle,
  Calendar,
} from "lucide-react";
import { apiUrl } from "@/lib/api-config";

// ---------------------------------------------------------------------------
// Tipos de Sync (espelho fiel de supabase/functions/api/notify/sync.ts)
// ---------------------------------------------------------------------------

export type SyncSkipReason =
  | "channel_disabled"
  | "no_customer"
  | "already_enqueued"
  | "no_template"
  | "no_opt_in"
  | "invalid_phone"
  | "push_pending"
  | "no_channel";

export interface SyncItem {
  dedupeKey: string;
  eventKey: string;
  ruleKey: string;
  billingId: string;
  customerId: string;
  customerName: string;
  reference: string;
  dueDate: string;
  sendDate: string;
  scheduledFor: number;
  channel: string | null;
  target: string | null;
  targetMasked: string | null;
  outcome: "enqueue" | "skip";
  reason: SyncSkipReason | null;
  detail: string;
  preview: { title?: string; body: string } | null;
  payload: Record<string, unknown> | null;
}

export interface SyncSummary {
  dryRun: boolean;
  day: { from: string; to: string; days: number };
  dueWindow: { from: string; to: string };
  settings: {
    fingerprint: string;
    origin: "db" | "defaults";
    updatedAt: number | null;
    updatedBy: string | null;
    rulesActive: string[];
  };
  source: { billings: number; customers: number; contacts: number };
  plan: {
    planned: number;
    toEnqueue: number;
    skipped: Record<SyncSkipReason, number>;
    byRule: Record<string, number>;
  };
  enqueued: number;
  duplicates: number;
  blocked: SyncSkipReason | null;
  templateWarnings: string[];
  assumptions: string[];
  items: SyncItem[];
  itemsTruncated: boolean;
}

export interface AdminSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback opcional quando o sync real for concluído */
  onSyncCompleted?: (summary: SyncSummary) => void;
  /** Ação opcional para disparar imediatamente o modal de envio outbox */
  onOpenDispatch?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers de Autenticação e Formatação
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
  if (token) {
    headers.set("x-admin-token", token);
  }
  return fetch(withAdminToken(apiUrl(url)), {
    ...init,
    headers,
    credentials: "include",
  });
}

function formatDateBR(iso: string | undefined): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

function getCivilToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatRuleLabel(ruleKey: string): string {
  switch (ruleKey) {
    case "d_minus_3":
      return "3 dias antes (D-3)";
    case "due_date":
    case "d_0":
      return "No vencimento (D0)";
    case "d_plus_1":
      return "1 dia vencido (D+1)";
    case "d_plus_5":
      return "5 dias vencido (D+5)";
    default:
      return ruleKey.replace(/_/g, " ");
  }
}

export function describeReason(reason: SyncSkipReason | null): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (reason) {
    case "already_enqueued":
      return {
        label: "Já enfileirado",
        badgeClass:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        description: "Evento já existe na outbox com a mesma chave (dedupe)",
      };
    case "no_opt_in":
      return {
        label: "Sem opt-in",
        badgeClass:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
        description: "Cliente sem consentimento de WhatsApp registrado",
      };
    case "invalid_phone":
      return {
        label: "Telefone inválido",
        badgeClass:
          "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
        description: "Telefone fixo, malformado ou ausente",
      };
    case "push_pending":
      return {
        label: "Aguardando Push",
        badgeClass:
          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
        description: "Cliente só tem push; adapter de push ainda não migrado",
      };
    case "channel_disabled":
      return {
        label: "Canal desativado",
        badgeClass:
          "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
        description: "WhatsApp desligado na configuração",
      };
    case "no_template":
      return {
        label: "Sem template",
        badgeClass:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
        description: "Nenhum template ativo para a regra deste evento",
      };
    case "no_customer":
      return {
        label: "Sem cadastro",
        badgeClass:
          "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
        description: "Cadastro do cliente não retornado na varredura",
      };
    case "no_channel":
      return {
        label: "Sem canal",
        badgeClass:
          "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        description: "Nenhum canal de envio elegível disponível",
      };
    default:
      return {
        label: reason ?? "Descartado",
        badgeClass:
          "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        description: "Descartado pelo planejamento",
      };
  }
}

// ---------------------------------------------------------------------------
// Componente Principal
// ---------------------------------------------------------------------------

export function AdminSyncDialog({
  open,
  onOpenChange,
  onSyncCompleted,
  onOpenDispatch,
}: AdminSyncDialogProps) {
  const [fromDate, setFromDate] = useState<string>(getCivilToday);
  const [days, setDays] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  // Filtros locais
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Carrega prévia em dryRun
  const loadPreview = useCallback(
    async (overrideFrom?: string, overrideDays?: number) => {
      setLoading(true);
      setError(null);
      try {
        const queryFrom = overrideFrom ?? fromDate;
        const queryDays = overrideDays ?? days;
        const res = await adminFetch(
          `/api/cron/notify-sync?dryRun=1&from=${queryFrom}&days=${queryDays}&item-limit=200`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Falha ao calcular prévia de sincronização.");
          return;
        }
        setSummary(data as SyncSummary);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Erro de conexão ao calcular prévia de sincronização."
        );
      } finally {
        setLoading(false);
      }
    },
    [fromDate, days]
  );

  // Ao abrir o diálogo, dispara a prévia se ainda não carregada
  useEffect(() => {
    if (open && !summary && !loading) {
      void loadPreview();
    }
    if (!open) {
      setSearch("");
      setReasonFilter("all");
    }
  }, [open, summary, loading, loadPreview]);

  // Executa o sync real gravando na outbox
  const handleExecuteSync = async () => {
    if (!summary) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await adminFetch("/api/cron/notify-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          from: fromDate,
          days,
          "item-limit": 200,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Falha ao executar sincronização real.");
        toast.error(data.error || "Erro ao enfileirar avisos.");
        return;
      }
      const finishedSummary = data as SyncSummary;
      setSummary(finishedSummary);
      toast.success(
        `${finishedSummary.enqueued} aviso(s) enfileirado(s) com sucesso na outbox!`
      );
      if (finishedSummary.duplicates > 0) {
        toast.info(
          `${finishedSummary.duplicates} aviso(s) já estavam na fila e foram ignorados.`
        );
      }
      onSyncCompleted?.(finishedSummary);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Erro de conexão ao executar sincronização.";
      setError(msg);
      toast.error(msg);
    } finally {
      setExecuting(false);
    }
  };

  const toggleExpand = (dedupeKey: string) => {
    setExpandedItems((prev) => ({ ...prev, [dedupeKey]: !prev[dedupeKey] }));
  };

  // Itens filtrados por busca e categoria
  const filteredItems = useMemo(() => {
    if (!summary) return [];
    return summary.items.filter((item) => {
      // Filtro de motivo / status
      if (reasonFilter === "enqueue" && item.outcome !== "enqueue") return false;
      if (reasonFilter === "skip" && item.outcome !== "skip") return false;
      if (
        reasonFilter !== "all" &&
        reasonFilter !== "enqueue" &&
        reasonFilter !== "skip" &&
        item.reason !== reasonFilter
      ) {
        return false;
      }

      // Busca textual
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.customerName.toLowerCase().includes(q) ||
        item.billingId.toLowerCase().includes(q) ||
        (item.targetMasked && item.targetMasked.toLowerCase().includes(q)) ||
        (item.detail && item.detail.toLowerCase().includes(q)) ||
        (item.preview?.body && item.preview.body.toLowerCase().includes(q))
      );
    });
  }, [summary, search, reasonFilter]);

  // Contagem de descartes não-nulos para os botões de filtro
  const activeSkipCounts = useMemo(() => {
    if (!summary) return [];
    return (
      Object.entries(summary.plan.skipped) as [SyncSkipReason, number][]
    ).filter(([, count]) => count > 0);
  }, [summary]);

  const totalSkipped = useMemo(() => {
    if (!summary) return 0;
    return Object.values(summary.plan.skipped).reduce((acc, n) => acc + n, 0);
  }, [summary]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden gap-0">
        {/* Header do Diálogo */}
        <DialogHeader className="p-5 pb-3 border-b border-border shrink-0 bg-card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RefreshCw
                  className={`h-4 w-4 text-emerald-600 ${
                    loading ? "animate-spin" : ""
                  }`}
                />
                <DialogTitle className="text-base font-semibold text-foreground">
                  Sincronização Diária de Cobranças
                </DialogTitle>
                {summary && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 py-0.5 font-normal ${
                      summary.dryRun
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    }`}
                  >
                    {summary.dryRun ? "Prévia (dry-run)" : "Executado"}
                  </Badge>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Varre faturas com vencimento na janela das regras ativas, planeja
                os avisos do dia e expõe os motivos de cada descarte antes do
                enfileiramento.
              </DialogDescription>
            </div>

            {/* Configuração de Data e Horizonte */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    if (e.target.value) void loadPreview(e.target.value, days);
                  }}
                  className="h-8 text-xs font-mono w-[130px]"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => loadPreview()}
                disabled={loading || executing}
              >
                <RefreshCw
                  className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
                />
                Atualizar prévia
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Conteúdo rolável */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Mensagem de Erro */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">Falha na sincronização</p>
                <p className="text-[11px] leading-relaxed opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Banner de Lote Bloqueado */}
          {summary?.blocked && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <div>
                <p className="font-semibold">Lote Bloqueado pelo Canal</p>
                <p className="text-[11px] mt-0.5 leading-relaxed">
                  O canal WhatsApp está desligado na configuração. Para evitar
                  rajadas retroativas de cobrança quando religado, o lote inteiro
                  fica bloqueado. Ative o canal em Configurações para prosseguir.
                </p>
              </div>
            </div>
          )}

          {/* Banner de Sucesso de Execução Real */}
          {summary && !summary.dryRun && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              <div className="space-y-1">
                <p className="font-semibold">
                  Sincronização Concluída e Gravada no Outbox
                </p>
                <p className="text-[11px] leading-relaxed">
                  <strong>{summary.enqueued}</strong> evento(s) enfileirado(s). O
                  cron disparador (<code className="font-mono">notify-dispatch</code>)
                  efetuará a entrega respeitando a janela horária e os limites de
                  conversas diárias.
                  {summary.duplicates > 0
                    ? ` (${summary.duplicates} já estavam na fila).`
                    : ""}
                </p>
              </div>
            </div>
          )}

          {/* Estado de Carregamento Inicial */}
          {loading && !summary && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Consultando base da MikWeb...
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Calculando régua de lembretes, janela de vencimento, consentimento
                  de contatos e deduplicação do outbox.
                </p>
              </div>
            </div>
          )}

          {summary && (
            <>
              {/* Cards de Métricas Principais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Card className="border-border shadow-none bg-card">
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">A Enfileirar</span>
                      <Send className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <p className="text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                      {summary.dryRun ? summary.plan.toEnqueue : summary.enqueued}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {summary.dryRun ? "Elegíveis hoje" : "Enfileirados agora"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border shadow-none bg-card">
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">Fora da Fila</span>
                      <XCircle className="h-3.5 w-3.5 text-amber-600" />
                    </div>
                    <p className="text-2xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">
                      {totalSkipped}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Descartados / ignorados
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border shadow-none bg-card">
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">Total Planejado</span>
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-semibold tracking-tight text-foreground">
                      {summary.plan.planned}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Mapeados na régua hoje
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border shadow-none bg-card">
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">Faturas Varridas</span>
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-semibold tracking-tight text-foreground">
                      {summary.source.billings}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      Venc: {formatDateBR(summary.dueWindow.from)} a{" "}
                      {formatDateBR(summary.dueWindow.to)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Barra de Filtros por Motivo de Descarte */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Filter className="h-3 w-3" /> Filtrar por motivo de descarte:
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Exibindo {filteredItems.length} de {summary.items.length} avisos
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setReasonFilter("all")}
                    className={`text-[11px] px-2.5 py-1 rounded-sm border transition-colors cursor-pointer ${
                      reasonFilter === "all"
                        ? "bg-foreground text-background border-foreground font-medium"
                        : "bg-secondary/60 text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    Todos ({summary.items.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setReasonFilter("enqueue")}
                    className={`text-[11px] px-2.5 py-1 rounded-sm border transition-colors cursor-pointer ${
                      reasonFilter === "enqueue"
                        ? "bg-emerald-600 text-white border-emerald-600 font-medium"
                        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20"
                    }`}
                  >
                    A enfileirar ({summary.plan.toEnqueue})
                  </button>

                  {activeSkipCounts.map(([reason, count]) => {
                    const info = describeReason(reason);
                    const active = reasonFilter === reason;
                    return (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setReasonFilter(active ? "all" : reason)}
                        className={`text-[11px] px-2.5 py-1 rounded-sm border transition-colors cursor-pointer ${
                          active
                            ? "bg-foreground text-background border-foreground font-medium"
                            : `${info.badgeClass} hover:opacity-90`
                        }`}
                        title={info.description}
                      >
                        {info.label} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Campo de Busca Rápida */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Buscar por cliente, ID da fatura, telefone ou texto da mensagem..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs bg-card"
                />
              </div>

              {/* Tabela de Itens Planejados */}
              <div className="rounded-md border border-border bg-card overflow-hidden">
                <div className="max-h-[340px] overflow-y-auto divide-y divide-border">
                  {filteredItems.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      Nenhum aviso encontrado para os filtros selecionados.
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const isEnqueued = item.outcome === "enqueue";
                      const reasonMeta = describeReason(item.reason);
                      const isExpanded = !!expandedItems[item.dedupeKey];

                      return (
                        <div
                          key={item.dedupeKey}
                          className="p-3 text-xs space-y-2 hover:bg-muted/30 transition-colors"
                        >
                          {/* Linha Principal */}
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-foreground">
                                  {item.customerName}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  #{item.billingId}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 font-normal bg-secondary"
                                >
                                  {formatRuleLabel(item.ruleKey)}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                <span>
                                  Vencimento:{" "}
                                  <strong className="font-normal text-foreground">
                                    {formatDateBR(item.dueDate)}
                                  </strong>
                                </span>
                                {item.targetMasked && (
                                  <span className="flex items-center gap-1 font-mono">
                                    <Phone className="h-2.5 w-2.5" />
                                    {item.targetMasked}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Status & Motivo de Descarte */}
                            <div className="flex items-center gap-2 shrink-0">
                              {isEnqueued ? (
                                <Badge
                                  className="text-[10px] px-2 py-0.5 font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                                >
                                  A enfileirar
                                </Badge>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    className={`text-[10px] px-2 py-0.5 font-medium border ${reasonMeta.badgeClass}`}
                                  >
                                    {reasonMeta.label}
                                  </Badge>
                                </div>
                              )}

                              {item.preview?.body && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => toggleExpand(item.dedupeKey)}
                                  title="Ver texto do lembrete"
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Detalhe Humano do Motivo (quando descartado) */}
                          {!isEnqueued && item.detail && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded-sm">
                              <Info className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                              <span className="leading-tight">
                                Motivo: {item.detail}
                              </span>
                            </div>
                          )}

                          {/* Prévia Expandida da Mensagem */}
                          {isExpanded && item.preview?.body && (
                            <div className="mt-2 p-2.5 rounded-sm bg-emerald-500/5 border border-emerald-500/20 text-[11px] font-sans text-foreground/90 space-y-1">
                              <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                Prévia do texto planejado:
                              </p>
                              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground font-mono text-[10.5px]">
                                {item.preview.body}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Informações Complementares de Rodapé */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground pt-1">
                <span>
                  Chave idempotente:{" "}
                  <code className="font-mono">billing:&lt;id&gt;:&lt;regra&gt;</code>{" "}
                  (não gera duplicidade mesmo executando repetidamente).
                </span>
                <span>
                  Origem das configurações:{" "}
                  <strong className="font-medium text-foreground">
                    {summary.settings.origin}
                  </strong>{" "}
                  · Regras ativas: {summary.settings.rulesActive.join(", ") || "nenhuma"}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Rodapé com Ações */}
        <DialogFooter className="p-4 border-t border-border shrink-0 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {summary?.dryRun ? (
              <span>
                Nenhum evento foi gravado ainda. Revise a lista e confirme.
              </span>
            ) : (
              <span className="text-emerald-600 font-medium">
                ✓ Eventos prontos na outbox para envio pelo cron.
              </span>
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

            {summary && !summary.dryRun && onOpenDispatch && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-9 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                onClick={() => {
                  onOpenChange(false);
                  onOpenDispatch();
                }}
              >
                <Send className="h-3.5 w-3.5" />
                Disparar fila agora
              </Button>
            )}

            {summary && summary.dryRun && summary.plan.toEnqueue > 0 && (
              <Button
                size="sm"
                className="text-xs h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                disabled={executing || loading || !!summary.blocked}
                onClick={handleExecuteSync}
              >
                {executing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Enfileirando avisos...
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Confirmar e enfileirar agora ({summary.plan.toEnqueue})
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
