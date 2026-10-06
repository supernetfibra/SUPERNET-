/**
 * Admin Referrals Page — gestão do programa "Indique e Ganhe".
 *
 * Abas: Indicações (quem indicou quem, status, pontos), Catálogo (recompensas),
 * Resgates (aprovar/recusar/aplicar) e Configuração (enabled, pontos por
 * aprovação, ajuste manual de saldo auditado).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Gift,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Users,
  Coins,
  Clock,
  CheckCircle2,
  XCircle,
  PackageCheck,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table";
import type { DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  adjustPoints,
  createReferralReward,
  decideRedemption,
  deactivateReferralReward,
  fetchAdminReferrals,
  saveReferralConfig,
  updateReferralReward,
  type ReferralAdminData,
  type ReferralReward,
} from "@/lib/referral-api";
import { plural } from "@/lib/plural";

function formatPoints(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maskCpfForAdmin(cpf: string): string {
  const d = String(cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}.-**`;
}

type ReferralStatus = "pending" | "approved" | "rejected";
type RedemptionStatus = "pending" | "approved" | "rejected" | "applied";

function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  const map: Record<ReferralStatus, { label: string; tone: "success" | "danger" | "warning" }> = {
    approved: { label: "Aprovada", tone: "success" },
    rejected: { label: "Recusada", tone: "danger" },
    pending: { label: "Pendente", tone: "warning" },
  };
  const item = map[status];
  return (
    <StatusBadge variant="soft" tone={item.tone} label={item.label} />
  );
}

type AdminReferralRow = ReferralAdminData["referrals"][number];
type AdminRedemptionRow = ReferralAdminData["redemptions"][number];

const referralColumns: DataTableColumn<AdminReferralRow>[] = [
  {
    key: "full_name",
    header: "Indicado",
    render: (r) => (
      <div>
        <div className="font-medium">{r.full_name}</div>
        <div className="text-xs text-muted-foreground">{maskCpfForAdmin(r.cpf)}</div>
      </div>
    ),
  },
  { key: "referrer_name", header: "Indicador" },
  // 4.7 — mobile: Código é secundário; some <640px em vez de forçar scroll.
  { key: "referral_code", header: "Código", className: "font-mono text-xs", hideBelow: "sm" },
  {
    key: "created_at",
    header: "Data",
    className: "text-xs text-muted-foreground whitespace-nowrap",
    sortValue: (r) => r.created_at,
    render: (r) => formatDateTime(r.created_at),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => <ReferralStatusBadge status={r.status} />,
  },
];

const redemptionColumns: DataTableColumn<AdminRedemptionRow>[] = [
  {
    key: "customer_name",
    header: "Cliente",
    render: (r) => (
      <div>
        <div className="font-medium">{r.customer_name || r.customer_ref}</div>
        <div className="text-xs text-muted-foreground font-mono">{r.customer_ref}</div>
      </div>
    ),
  },
  { key: "reward_title", header: "Recompensa" },
  {
    key: "points_cost",
    header: "Pontos",
    className: "tabular-nums",
    sortValue: (r) => r.points_cost,
    render: (r) => `−${formatPoints(r.points_cost)}`,
  },
  {
    key: "created_at",
    header: "Data",
    className: "text-xs text-muted-foreground whitespace-nowrap",
    sortValue: (r) => r.created_at,
    render: (r) => formatDateTime(r.created_at),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => <RedemptionStatusBadge status={r.status} />,
  },
];

function RedemptionStatusBadge({ status }: { status: RedemptionStatus }) {
  const map: Record<RedemptionStatus, { label: string; tone: "warning" | "info" | "success" | "danger" }> = {
    pending: { label: "Em análise", tone: "warning" },
    approved: { label: "Aprovado", tone: "info" },
    applied: { label: "Aplicado", tone: "success" },
    rejected: { label: "Recusado", tone: "danger" },
  } as const;
  const item = map[status];
  return <StatusBadge variant="soft" tone={item.tone} label={item.label} />;
}

interface RewardFormState {
  id: string | null;
  title: string;
  description: string;
  pointsCost: string;
  kind: ReferralReward["kind"];
  sortOrder: string;
  active: boolean;
}

const EMPTY_REWARD: RewardFormState = {
  id: null,
  title: "",
  description: "",
  pointsCost: "100",
  kind: "desconto",
  sortOrder: "0",
  active: true,
};

export default function AdminReferrals() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReferralAdminData | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Config
  const [cfgEnabled, setCfgEnabled] = useState(true);
  const [cfgPoints, setCfgPoints] = useState("100");

  // Recompensa (criar/editar)
  const [rewardForm, setRewardForm] = useState<RewardFormState>(EMPTY_REWARD);
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);

  // Ajuste manual de pontos
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ customerRef: "", delta: "", reason: "" });

  // Decisão de resgate
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; decision: "approved" | "rejected" | "applied"; title: string } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchAdminReferrals();
    if (result.ok) {
      setData(result.data);
      setMigrationPending(Boolean(result.data.migrationPending));
      setCfgEnabled(result.data.config?.enabled ?? true);
      setCfgPoints(String(result.data.config?.pointsPerApproved ?? 100));
      setLoadError(null);
    } else {
      setData(null);
      setMigrationPending(Boolean(result.migrationPending));
      setLoadError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveConfig = async () => {
    setBusy(true);
    const result = await saveReferralConfig({ enabled: cfgEnabled, pointsPerApproved: Number(cfgPoints) || 100 });
    setBusy(false);
    if (result.ok) toast.success("Configuração salva.");
    else toast.error(result.error);
    await load();
  };

  const handleSaveReward = async () => {
    const pointsCost = Number(rewardForm.pointsCost);
    if (rewardForm.title.trim().length < 2) {
      toast.error("Informe o título da recompensa.");
      return;
    }
    if (!Number.isFinite(pointsCost) || pointsCost < 1) {
      toast.error("Custo em pontos deve ser maior que zero.");
      return;
    }
    setBusy(true);
    const payload = {
      title: rewardForm.title.trim(),
      description: rewardForm.description.trim() || undefined,
      pointsCost,
      kind: rewardForm.kind,
      sortOrder: Number(rewardForm.sortOrder) || 0,
      active: rewardForm.active,
    };
    const result = rewardForm.id
      ? await updateReferralReward(rewardForm.id, {
          title: payload.title,
          description: payload.description,
          points_cost: payload.pointsCost,
          kind: payload.kind,
          sort_order: payload.sortOrder,
          active: payload.active,
        })
      : await createReferralReward(payload);
    setBusy(false);
    if (result.ok) {
      toast.success(rewardForm.id ? "Recompensa atualizada." : "Recompensa criada.");
      setRewardDialogOpen(false);
      setRewardForm(EMPTY_REWARD);
      await load();
    } else {
      toast.error(result.error);
    }
  };

  const handleDeactivateReward = async (reward: ReferralReward) => {
    if (!window.confirm(`Desativar "${reward.title}"? O histórico de resgates é preservado.`)) return;
    setBusy(true);
    const result = await deactivateReferralReward(reward.id);
    setBusy(false);
    if (result.ok) toast.success("Recompensa desativada.");
    else toast.error(result.error);
    await load();
  };

  const handleDecision = async () => {
    if (!decisionTarget) return;
    setBusy(true);
    const result = await decideRedemption(decisionTarget.id, decisionTarget.decision, decisionNote.trim() || undefined);
    setBusy(false);
    setDecisionTarget(null);
    setDecisionNote("");
    if (result.ok) {
      toast.success(
        decisionTarget.decision === "rejected"
          ? "Resgate recusado e pontos devolvidos ao cliente."
          : decisionTarget.decision === "applied"
            ? "Marcado como aplicado."
            : "Resgate aprovado. Lance o crédito na fatura e marque como aplicado."
      );
      await load();
    } else {
      toast.error(result.error);
    }
  };

  const handleAdjust = async () => {
    const delta = Number(adjustForm.delta);
    if (!adjustForm.customerRef.trim()) {
      toast.error("Informe o identificador do cliente.");
      return;
    }
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Informe um valor diferente de zero.");
      return;
    }
    if (adjustForm.reason.trim().length < 3) {
      toast.error("Descreva o motivo do ajuste.");
      return;
    }
    setBusy(true);
    const result = await adjustPoints({
      customerRef: adjustForm.customerRef.trim(),
      delta,
      reason: adjustForm.reason.trim(),
    });
    setBusy(false);
    if (result.ok) {
      toast.success("Ajuste registrado no histórico.");
      setAdjustOpen(false);
      setAdjustForm({ customerRef: "", delta: "", reason: "" });
      await load();
    } else {
      toast.error(result.error);
    }
  };

  const openEditReward = (reward: ReferralReward) => {
    setRewardForm({
      id: reward.id,
      title: reward.title,
      description: reward.description ?? "",
      pointsCost: String(reward.points_cost),
      kind: reward.kind,
      sortOrder: String(reward.sort_order),
      active: reward.active,
    });
    setRewardDialogOpen(true);
  };

  const renderRedemptionActions = (r: AdminRedemptionRow) => (
    <>
      {r.status === "pending" && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
            disabled={busy}
            onClick={() => setDecisionTarget({ id: r.id, decision: "approved", title: r.reward_title })}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setDecisionTarget({ id: r.id, decision: "rejected", title: r.reward_title })}
          >
            <XCircle className="h-3 w-3 mr-1" /> Recusar
          </Button>
        </>
      )}
      {r.status === "approved" && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => setDecisionTarget({ id: r.id, decision: "applied", title: r.reward_title })}
        >
          <PackageCheck className="h-3 w-3 mr-1" /> Marcar aplicado
        </Button>
      )}
      {r.status === "applied" && (
        <span className="text-xs text-muted-foreground">
          {r.applied_at ? formatDateTime(r.applied_at) : ""}
        </span>
      )}
    </>
  );

  const stats = data?.stats;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        onBack={() => navigate("/admin/dashboard")}
        backLabel="Voltar ao dashboard"
        icon={Gift}
        title="Indique e Ganhe"
        description="Programa de indicação, pontos e recompensas."
        actions={
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => setAdjustOpen(true)}>
            <Coins className="h-3.5 w-3.5 mr-1" /> Ajustar pontos
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : migrationPending ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <TriangleAlert className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-muted-foreground max-w-md">
              A migration <code className="text-xs">011_referrals.sql</code> ainda não foi aplicada no banco. Aplique-a
              pelo SQL Editor do Supabase para ativar o programa.
            </p>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar o programa"
            description={loadError}
            onRetry={() => void load()}
            retrying={loading}
          />
        </Card>
      ) : data ? (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Users className="h-3.5 w-3.5" /> Indicações
                </div>
                <div className="text-xl font-bold tabular-nums">{stats?.totalReferrals ?? 0}</div>
                <div className="text-xs text-muted-foreground">{plural(stats?.pendingReferrals ?? 0, "pendente", "pendentes")}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Coins className="h-3.5 w-3.5" /> Pontos emitidos
                </div>
                <div className="text-xl font-bold tabular-nums">{formatPoints(stats?.pointsIssued ?? 0)}</div>
                <div className="text-xs text-muted-foreground">{formatPoints(stats?.pointsSpent ?? 0)} resgatados</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3.5 w-3.5" /> Resgates em análise
                </div>
                <div className="text-xl font-bold tabular-nums">{stats?.redemptionsPending ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <PackageCheck className="h-3.5 w-3.5" /> Clientes com pontos
                </div>
                <div className="text-xl font-bold tabular-nums">{stats?.activeCustomers ?? 0}</div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="referrals">
            <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap">
              <TabsTrigger value="referrals">Indicações</TabsTrigger>
              <TabsTrigger value="rewards">Catálogo</TabsTrigger>
              <TabsTrigger value="redemptions">
                Resgates
                {(stats?.redemptionsPending ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                    {stats?.redemptionsPending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="config">Configuração</TabsTrigger>
            </TabsList>

            {/* ── Indicações ── */}
            <TabsContent value="referrals" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Solicitações vindas de indicação</CardTitle>
                  <CardDescription className="text-xs">
                    Aprovar uma solicitação credita automaticamente os pontos ao indicador (idempotente — re-aprovar
                    não duplica).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.referrals.length === 0 ? (
                    <EmptyState icon={Users} title="Nenhuma indicação registrada ainda." />
                  ) : (
                    <DataTable
                      columns={referralColumns}
                      data={data.referrals}
                      getRowId={(r) => r.id}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Catálogo ── */}
            <TabsContent value="rewards" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Recompensas</CardTitle>
                    <CardDescription className="text-xs">
                      Descontos, bonificações e premiações trocáveis por pontos.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => {
                      setRewardForm(EMPTY_REWARD);
                      setRewardDialogOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Nova
                  </Button>
                </CardHeader>
                <CardContent>
                  {data.rewards.length === 0 ? (
                    <EmptyState icon={PackageCheck} title="Nenhuma recompensa cadastrada. Crie a primeira!" />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {data.rewards.map((reward) => (
                        <div
                          key={reward.id}
                          className={`rounded-lg border p-4 flex flex-col gap-2 ${!reward.active ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium leading-tight flex items-center gap-2">
                                {reward.title}
                                {!reward.active && <Badge variant="secondary" className="text-xs">Inativa</Badge>}
                              </div>
                              <div className="text-xs text-muted-foreground capitalize">{reward.kind}</div>
                            </div>
                            <Badge variant="secondary" className="tabular-nums shrink-0">
                              {formatPoints(reward.points_cost)} pts
                            </Badge>
                          </div>
                          {reward.description && (
                            <p className="text-xs text-muted-foreground leading-relaxed">{reward.description}</p>
                          )}
                          <div className="flex gap-1.5 mt-auto pt-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEditReward(reward)}>
                              <Pencil className="h-3 w-3 mr-1" /> Editar
                            </Button>
                            {reward.active && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-destructive hover:text-destructive"
                                onClick={() => handleDeactivateReward(reward)}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> Desativar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Resgates ── */}
            <TabsContent value="redemptions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pedidos de resgate</CardTitle>
                  <CardDescription className="text-xs">
                    Fluxo: aprovar → lançar o crédito na fatura (MikWeb) → marcar como aplicado. Recusar devolve os
                    pontos automaticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.redemptions.length === 0 ? (
                    <EmptyState icon={Clock} title="Nenhum resgate ainda." />
                  ) : (
                    <DataTable
                      columns={redemptionColumns}
                      data={data.redemptions}
                      getRowId={(r) => r.id}
                      rowActions={renderRedemptionActions}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Configuração ── */}
            <TabsContent value="config" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" /> Regras do programa
                  </CardTitle>
                  <CardDescription className="text-xs">
                    O link do cliente é gerado automaticamente quando ele abre "Indique e Ganhe".
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 max-w-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="referral-enabled" className="text-sm">Programa ativo</Label>
                      <p className="text-xs text-muted-foreground">
                        Desativado: links param de gerar pontos e novos resgates são bloqueados.
                      </p>
                    </div>
                    <Switch id="referral-enabled" checked={cfgEnabled} onCheckedChange={setCfgEnabled} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="referral-points" className="text-sm">Pontos por indicação aprovada</Label>
                    <Input
                      id="referral-points"
                      type="number"
                      min={1}
                      max={100000}
                      value={cfgPoints}
                      onChange={(e) => setCfgPoints(e.target.value)}
                      className="w-40 tabular-nums"
                    />
                    <p className="text-xs text-muted-foreground">Creditados quando você aprova a instalação indicada.</p>
                  </div>
                  <Button size="sm" onClick={handleSaveConfig} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar configuração
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      {/* Dialog: criar/editar recompensa */}
      <Dialog open={rewardDialogOpen} onOpenChange={setRewardDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{rewardForm.id ? "Editar recompensa" : "Nova recompensa"}</DialogTitle>
            <DialogDescription>
              {rewardForm.id
                ? "Pedidos antigos mantêm o custo e o título do momento do resgate."
                : "Aparece no catálogo da área do cliente."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reward-title">Título</Label>
              <Input
                id="reward-title"
                value={rewardForm.title}
                onChange={(e) => setRewardForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex.: R$ 20 de desconto na fatura"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reward-description">Descrição (opcional)</Label>
              <Textarea
                id="reward-description"
                value={rewardForm.description}
                onChange={(e) => setRewardForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Condições, restrições, prazo…"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reward-cost">Custo (pontos)</Label>
                <Input
                  id="reward-cost"
                  type="number"
                  min={1}
                  value={rewardForm.pointsCost}
                  onChange={(e) => setRewardForm((f) => ({ ...f, pointsCost: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={rewardForm.kind}
                  onValueChange={(v) => setRewardForm((f) => ({ ...f, kind: v as ReferralReward["kind"] }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desconto">Desconto na fatura</SelectItem>
                    <SelectItem value="bonificacao">Bonificação</SelectItem>
                    <SelectItem value="premiacao">Premiação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="reward-sort">Ordem de exibição</Label>
                <Input
                  id="reward-sort"
                  type="number"
                  value={rewardForm.sortOrder}
                  onChange={(e) => setRewardForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  className="w-28 tabular-nums"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  id="reward-active"
                  checked={rewardForm.active}
                  onCheckedChange={(v) => setRewardForm((f) => ({ ...f, active: v }))}
                />
                <Label htmlFor="reward-active" className="text-sm">Ativa</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRewardDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveReward} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {rewardForm.id ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: decisão de resgate */}
      <Dialog open={Boolean(decisionTarget)} onOpenChange={(open) => !open && setDecisionTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {decisionTarget?.decision === "approved"
                ? "Aprovar resgate"
                : decisionTarget?.decision === "applied"
                  ? "Marcar como aplicado"
                  : "Recusar resgate"}
            </DialogTitle>
            <DialogDescription>
              {decisionTarget?.decision === "approved"
                ? `Aprovar "${decisionTarget?.title}"? Depois lance o crédito na fatura do cliente no MikWeb e marque como aplicado.`
                : decisionTarget?.decision === "applied"
                  ? `Confirma que o crédito de "${decisionTarget?.title}" foi lançado na fatura do cliente?`
                  : `Recusar "${decisionTarget?.title}"? Os pontos voltam automaticamente para o saldo do cliente.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-note">Observação (opcional)</Label>
            <Input
              id="decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="Ex.: lançado na fatura 12345/10"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecisionTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleDecision} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: ajuste manual de pontos */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar pontos</DialogTitle>
            <DialogDescription>
              Crédito ou débito manual com motivo — fica no histórico para auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adjust-customer">Cliente (identificador)</Label>
              <Input
                id="adjust-customer"
                value={adjustForm.customerRef}
                onChange={(e) => setAdjustForm((f) => ({ ...f, customerRef: e.target.value }))}
                placeholder="Ex.: a:123 (prefixo da conta + id MikWeb)"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                O identificador aparece na lista de resgates e no histórico.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-delta">Valor (+ crédito / − débito)</Label>
              <Input
                id="adjust-delta"
                type="number"
                value={adjustForm.delta}
                onChange={(e) => setAdjustForm((f) => ({ ...f, delta: e.target.value }))}
                placeholder="Ex.: 50 ou -20"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-reason">Motivo</Label>
              <Input
                id="adjust-reason"
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Ex.: compensação por falha no atendimento"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAdjust} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Aplicar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
