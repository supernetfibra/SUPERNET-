/**
 * AdminDashboard — dashboard OPERACIONAL (Fase 4, ETAPAS 4.2 e 4.3).
 *
 * Antes da Fase 4 concentrava gestão completa de instalações, auditoria,
 * consulta de cliente + lembrete, sessões, indicações e atalhos. Agora:
 *
 *   KPIs de acessos (resumo, fonte: /api/admin/audit-logs)      → permanece (A)
 *   Resumo de indicações (métricas do mês)                       → permanece (A)
 *   Instalações (era gestão completa com aprovar/recusar)        → resumo + atalho (4.3)
 *   Auditoria (log completo)                                     → página própria /admin/audit (4.4)
 *   Consultar cliente + faturas + lembrete                       → Cliente 360 /admin/customers/:cpf (4.5)
 *   Sessões ativas (lista completa + revogação)                  → sessões do cliente no Cliente 360 (4.5)
 *   Sincronizar cobranças / disparar outbox / mensagens          → atalhos (B)
 *
 * Nenhuma funcionalidade ficou inacessível: tudo o que saiu do dashboard tem
 * página dedicada com os MESMOS endpoints e regras. Regras de negócio
 * (aprovação de instalação, envio de lembrete, revogação de sessão) seguem
 * intocadas — mudou apenas onde a UI vive.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Clock,
  Coins,
  Gift,
  Home,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserX,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { AdminSyncDialog } from "@/components/AdminSyncDialog";
import { AdminDispatchDialog } from "@/components/AdminDispatchDialog";
import { ChannelHealthCard } from "@/components/ChannelHealthCard";
import { adminFetch, ADMIN_TOKEN_KEY } from "@/lib/api-config";
import type { ReferralMonthMetrics } from "../../supabase/functions/api/notify/referral-metrics.ts";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  // KPIs de acessos (resumo do endpoint de auditoria — o mesmo usado por /admin/audit)
  // todayFailures/last7DaysLogins são opcionais: o endpoint atual não devolve esses campos.
  const [auditSummary, setAuditSummary] = useState<{
    todayLogins?: number;
    todayFailures?: number;
    last7DaysLogins?: number;
    uniqueCpfs?: number;
  } | null>(null);

  // Instalações — apenas contadores (a lista e as ações vivem na página dedicada)
  const [installSummary, setInstallSummary] = useState<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  } | null>(null);

  // Métricas do programa de indicações
  const [referralMetrics, setReferralMetrics] = useState<ReferralMonthMetrics | null>(null);
  const [referralMigrationPending, setReferralMigrationPending] = useState(false);
  const [referralProgramEnabled, setReferralProgramEnabled] = useState(true);

  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);

  const welcomeShown = useRef(false);

  // Verificação de sessão — fluxo idêntico às outras páginas admin
  // (local + servidor; falha limpa token e pede login — sem mudança de auth).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await adminFetch("/api/admin/verify");
        if (cancelled) return;
        if (!res.ok) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          localStorage.removeItem(ADMIN_TOKEN_KEY + "_expires");
          setIsVerified(false);
        } else {
          setIsVerified(true);
        }
      } catch {
        if (!cancelled) setIsVerified(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isVerified && !welcomeShown.current) {
      welcomeShown.current = true;
      toast.success("Login realizado", {
        description: "Bem-vindo ao painel administrativo.",
        duration: 4000,
      });
    }
  }, [isVerified]);

  const loadSummary = useCallback(async () => {
    try {
      // 1 registro basta: o summary vem sempre no payload.
      const res = await adminFetch("/api/admin/audit-logs?scope=customer");
      if (res.ok) {
        const data = await res.json();
        setAuditSummary(data.summary || null);
      }
    } catch {
      // KPIs são acessórios — o dashboard não quebra sem eles.
    }
  }, []);

  const loadInstallSummary = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/install-requests");
      if (res.ok) {
        const data = await res.json();
        setInstallSummary(data.summary || null);
      }
    } catch {
      // idem
    }
  }, []);

  const loadReferralMetrics = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/referrals/stats");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (data.migrationPending) {
        setReferralMigrationPending(true);
        return;
      }
      setReferralMigrationPending(false);
      setReferralProgramEnabled(data.programEnabled !== false);
      setReferralMetrics(data.metrics ?? null);
    } catch {
      // silencioso — card continua com o estado anterior
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadInstallSummary(), loadReferralMetrics()]);
  }, [loadSummary, loadInstallSummary, loadReferralMetrics]);

  useEffect(() => {
    if (!isVerified) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão do dashboard original (loadAuditLogs/loadData)
    void refreshAll();
  }, [isVerified, refreshAll]);

  if (isVerified === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Activity className="h-5 w-5 animate-pulse text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Verificando sessão...</p>
      </div>
    );
  }

  if (isVerified === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 animate-[fadeIn_0.3s_ease-out]">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-base font-medium text-foreground">Sessão não encontrada</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Faça login novamente para acessar o painel administrativo.
          </p>
        </div>
        <Button size="sm" className="text-xs" onClick={() => navigate("/admin")}>
          Voltar ao login
        </Button>
      </div>
    );
  }

  const pendingInstallations = installSummary?.pending ?? 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
      <PageHeader
        title="Administração"
        description="Visão operacional do dia: acessos, pendências e atalhos das áreas de trabalho."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
              onClick={() => setSyncDialogOpen(true)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sincronizar cobranças
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
              onClick={() => setDispatchDialogOpen(true)}
            >
              <Send className="h-3.5 w-3.5" />
              Disparar fila outbox
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-9 gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/admin/messages")}
            >
              <Activity className="h-3.5 w-3.5" />
              Ver mensagens ao vivo
            </Button>
          </>
        }
      />

      {/* Saúde do canal WhatsApp — o "posso confiar no canal hoje?" antes de qualquer número */}
      <ChannelHealthCard />

      {/* KPIs — acessos de hoje e da semana (resumo; detalhe em /admin/audit) */}
      {auditSummary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard
            label="Logins (hoje)"
            value={auditSummary.todayLogins ?? "—"}
            icon={Users}
            tone="success"
            className="animate-[slideUp_0.3s_ease-out]"
          />
          <KpiCard
            label="Falhas (hoje)"
            value={auditSummary.todayFailures ?? "—"}
            icon={UserX}
            tone="danger"
            className="animate-[slideUp_0.3s_ease-out]"
          />
          <KpiCard
            label="Logins (7 dias)"
            value={auditSummary.last7DaysLogins ?? "—"}
            icon={Activity}
            tone="info"
            className="animate-[slideUp_0.3s_ease-out]"
          />
          <KpiCard
            label="CPFs únicos"
            value={auditSummary.uniqueCpfs ?? "—"}
            icon={Users}
            tone="secondary"
            className="animate-[slideUp_0.3s_ease-out]"
          />
        </div>
      ) : null}

      {/* Instalações — RESUMO + ATALHO (a gestão completa vive em /admin/install-requests) */}
      <Card
        className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.05s_both] cursor-pointer hover:bg-secondary/20 transition-colors"
        onClick={() => navigate("/admin/install-requests")}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Home className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Solicitações de Instalação</CardTitle>
              {pendingInstallations > 0 ? (
                <Badge
                  variant="outline"
                  className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-900"
                >
                  {pendingInstallations} pendente{pendingInstallations === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              ver instalações
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Pedidos enviados pela página inicial. Aprovar, recusar, fotos e impressão na página dedicada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <KpiCard label="Total" value={installSummary?.total ?? "—"} icon={Home} />
            <KpiCard label="Pendentes" value={installSummary?.pending ?? "—"} icon={Clock} tone="warning" />
            <KpiCard label="Aprovadas" value={installSummary?.approved ?? "—"} icon={BadgeCheck} tone="success" />
            <KpiCard label="Recusadas" value={installSummary?.rejected ?? "—"} icon={UserX} tone="danger" />
          </div>
        </CardContent>
      </Card>

      {/* Programa de Indicações — métricas do mês (resumo; gestão em /admin/referrals) */}
      {referralMigrationPending ? null : referralMetrics ? (
        <Card className="border-emerald-500/20 shadow-none animate-[slideUp_0.3s_ease-out_0.08s_both]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-sm font-medium">Indique e Ganhe</CardTitle>
                {!referralProgramEnabled && (
                  <Badge variant="secondary" className="text-xs font-medium">
                    programa desativado
                  </Badge>
                )}
              </div>
              <button
                onClick={() => navigate("/admin/referrals")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
              >
                Gerenciar
              </button>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Indicações recebidas em {referralMetrics.month.split("-").reverse().join("/")} e saldo geral do programa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">
                  {referralMetrics.referralsThisMonth}
                </p>
                <p className="text-xs text-muted-foreground">Indicações do mês</p>
                {referralMetrics.referralsThisMonth > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {referralMetrics.approvedThisMonth} aprovada
                    {referralMetrics.approvedThisMonth === 1 ? "" : "s"}
                  </p>
                )}
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">
                  {referralMetrics.approvalRatePct === null
                    ? "—"
                    : `${referralMetrics.approvalRatePct}%`}
                </p>
                <p className="text-xs text-muted-foreground">Taxa de aprovação (mês)</p>
                {referralMetrics.approvalRateAllPct !== null && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {referralMetrics.approvalRateAllPct}% no total
                  </p>
                )}
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">
                  {referralMetrics.pointsIssuedThisMonth.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">Pontos emitidos no mês</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {referralMetrics.pointsIssuedTotal.toLocaleString("pt-BR")} no total
                </p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">
                  {referralMetrics.pendingRedemptions}
                </p>
                <p className="text-xs text-muted-foreground">Resgates em análise</p>
                {referralMetrics.pointsRedeemedTotal > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {referralMetrics.pointsRedeemedTotal.toLocaleString("pt-BR")} pts resgatados
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Atalhos — as ferramentas completas têm página própria */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          className="border-border shadow-none cursor-pointer hover:bg-secondary/20 transition-colors animate-[slideUp_0.3s_ease-out_0.12s_both]"
          onClick={() => navigate("/admin/customers")}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Consultar cliente</CardTitle>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Faturas, sessões e histórico de qualquer CPF no Cliente 360.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card
          className="border-border shadow-none cursor-pointer hover:bg-secondary/20 transition-colors animate-[slideUp_0.3s_ease-out_0.16s_both]"
          onClick={() => navigate("/admin/audit")}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Auditoria</CardTitle>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Log completo de acessos e eventos de operação, com filtros.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card
          className="border-border shadow-none cursor-pointer hover:bg-secondary/20 transition-colors animate-[slideUp_0.3s_ease-out_0.2s_both]"
          onClick={() => navigate("/admin/messages")}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Mensagens e funil</CardTitle>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Outbox em tempo real, funil de engajamento e cliques nos botões.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card
          className="border-border shadow-none cursor-pointer hover:bg-secondary/20 transition-colors animate-[slideUp_0.3s_ease-out_0.24s_both]"
          onClick={() => navigate("/admin/connections")}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Conexões</CardTitle>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Credenciais MikWeb e WhatsApp, alertas e configuração técnica.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <AdminSyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onOpenDispatch={() => {
          setDispatchDialogOpen(true);
        }}
      />

      <AdminDispatchDialog
        open={dispatchDialogOpen}
        onOpenChange={setDispatchDialogOpen}
      />
    </div>
  );
}
