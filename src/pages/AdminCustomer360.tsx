/**
 * Admin Customer 360 — visão consolidada do cliente (Fase 4, ETAPA 4.5).
 *
 * Rota: /admin/customers/:cpf (dígito-verificador preservado; a busca por CPF
 * numérico navega para cá). Reúne, com endpoints JÁ EXISTENTES (nenhum backend
 * novo):
 *   - dados cadastrais + faturas  → GET /api/admin/customer?cpf=… (era o card
 *     "Consultar Cliente" do dashboard, com o mesmo payload);
 *   - lembrete WhatsApp            → POST /api/admin/notifications/send-now
 *     (dryRun + envio, mesma lógica do dashboard, incluindo o override de
 *     opt-in e o campo MULTI-CONTA `connection`);
 *   - sessões                      → GET /api/admin/sessions (filtro local);
 *   - auditoria do cliente         → GET /api/admin/audit-logs?cpf=…&scope=customer
 *     (DataTable paginado, 25/página).
 *
 * Lacunas documentadas (NÃO implementadas por dependerem de backend novo):
 *   - mensagens/outbox do cliente (o endpoint atual da outbox filtra por
 *     busca textual; o CPF casaria por substring, mas sem contrato dedicado —
 *     fica para fase futura);
 *   - indicações do cliente (o endpoint /api/admin/referrals retorna o
 *     programa inteiro, sem filtro por CPF).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundSearch,
  UserX,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import type { DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/components/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminFetch } from "@/lib/api-config";
import { plural } from "@/lib/plural";
import { mapStatus, formatDate as formatDueDate } from "@/lib/billing-utils";
import { formatBRL, auditTypeLabels, systemEventSubtitle, normalizeAuditLogs, type AuditEntry, type AuditLogRow } from "@/lib/audit-shared";
import { toast } from "sonner";

/** Tone semântico para um situation_name da MikWeb (mesma regra do dashboard). */
function situationTone(situation: string | null | undefined): StatusTone {
  const s = (situation || "").toLowerCase();
  if (s.includes("pago")) return "success";
  if (s.includes("vencid") || s.includes("atras")) return "danger";
  return "warning";
}

/** Formata data+hora completos (dd/mm/aaaa hh:mm). */
function formatDateTimeBR(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 000.000.000-00 */
function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

interface CustomerLookupResponse {
  customer: {
    id?: string | number;
    full_name?: string;
    plan?: { name?: string } | null;
    due_day?: string | number | null;
    city?: string | null;
    state?: string | null;
  };
  billings: Array<{
    id: string | number;
    reference?: string;
    due_day?: string;
    value?: number | string;
    situation_name?: string;
  }>;
  connection?: { slug: string; label: string };
}

interface ReminderPreview {
  status: "preview" | "sent" | "queued" | "already_sent" | "failed" | "blocked";
  reason: string;
  phoneMasked: string | null;
  optIn: boolean;
  preview: { title?: string; body: string } | null;
}

interface ActiveSession {
  sessionId: string;
  customerName?: string;
  cpf?: string;
  lastActivityAt: number;
}

/** Resposta de `GET /api/admin/audit-logs` (mesma do AdminAudit, sem summary). */
interface AuditLogsResponse {
  logs?: AuditLogRow[];
}

/** Linha de fatura da consulta (mesma apresentação do card antigo). */
function BillingRow({
  billing,
  onRemind,
}: {
  billing: CustomerLookupResponse["billings"][number];
  onRemind: (b: CustomerLookupResponse["billings"][number]) => void;
}) {
  const canRemind = ["pendente", "vencido"].includes(mapStatus(billing.situation_name || ""));
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-sm border border-border/60 text-xs">
      <div className="min-w-0">
        <p className="text-foreground font-medium truncate">{billing.reference}</p>
        <p className="text-muted-foreground">
          {billing.due_day ? formatDueDate(billing.due_day) : "Sem vencimento"} ·{" "}
          {formatBRL(billing.value ?? 0)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge
          tone={situationTone(billing.situation_name)}
          label={billing.situation_name || "—"}
          bordered
          className="rounded-sm text-[10px] font-medium px-1.5 py-0.5 shrink-0"
        />
        {canRemind ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs cursor-pointer"
            title="Enviar lembrete por WhatsApp"
            onClick={() => onRemind(billing)}
          >
            <MessageCircle className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">Lembrar</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Linha do histórico de auditoria do cliente (DataTable). */
interface CustomerAuditRow {
  key: string;
  entry: AuditEntry;
}

const customerAuditColumns: DataTableColumn<CustomerAuditRow>[] = [
  {
    key: "event",
    header: "Evento",
    render: (row) => {
      const info = auditTypeLabels[row.entry.type] || {
        label: row.entry.type,
        tone: "neutral" as StatusTone,
      };
      return (
        <StatusBadge
          tone={info.tone}
          label={info.label}
          className="text-xs font-medium px-1.5 py-0 shrink-0"
        />
      );
    },
  },
  {
    key: "detail",
    header: "Detalhe",
    // `min-w-` (não `max-w-`/`w-`): em table-layout auto, max-w não reserva
    // espaço e w- é apenas uma dica — o navegador espremia esta coluna para o
    // mínimo. min-w é o piso respeitado.
    // `whitespace-normal` é obrigatório porque o TableCell do DS aplica
    // `whitespace-nowrap` em todo <td> — sem isso a mensagem de erro longa
    // vaza por cima das colunas vizinhas.
    className: "min-w-[300px] whitespace-normal",
    render: (row) => {
      const lines: string[] = [];
      if (row.entry.errorMessage) lines.push(row.entry.errorMessage);
      const subtitle = systemEventSubtitle(row.entry);
      if (!row.entry.errorMessage && subtitle) lines.push(subtitle);
      if (row.entry.metadata?.reference) {
        lines.push(
          `Fatura ${row.entry.metadata.reference}${
            typeof row.entry.metadata.value === "number"
              ? ` · ${formatBRL(row.entry.metadata.value)}`
              : ""
          }`,
        );
      }
      if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="space-y-0.5 text-muted-foreground">
          {lines.map((line, i) => (
            <span key={i} className="block truncate" title={line}>
              {line}
            </span>
          ))}
        </div>
      );
    },
  },
  {
    key: "timestamp",
    header: "Data / Hora",
    sortValue: (row) => row.entry.timestamp,
    className: "whitespace-nowrap text-xs text-muted-foreground",
    render: (row) => formatDateTimeBR(row.entry.timestamp),
  },
];

/**
 * Timeline de mensagens do cliente — a "documentação dos disparos" no lugar
 * onde o atendente já está: o que foi planejado, o que saiu, o status real
 * (entregue/lido) e o motivo de cada estado. Consome a MESMA listagem da
 * página Mensagens (`?customerId=`), com o id PREFIXADO que a consulta por
 * CPF já devolve — nenhuma rota nova.
 */
interface CustomerMessageRow {
  id: string;
  channel: string;
  status: string;
  ruleLabel?: string | null;
  reasonLabel?: string | null;
  scheduledFor: number;
  sentAt: number | null;
}

const MESSAGE_STATUS_TONE: Record<string, string> = {
  queued: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  sending: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  sent: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  delivered: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  read: "border-emerald-600/40 text-emerald-700 dark:text-emerald-300",
  failed: "border-red-500/40 text-red-600 dark:text-red-400",
  skipped: "border-border text-muted-foreground",
  canceled: "border-border text-muted-foreground",
};

const MESSAGE_STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  skipped: "Não enviada",
  canceled: "Cancelada",
};

function CustomerMessagesCard({ customerId }: { customerId: string | undefined }) {
  const [rows, setRows] = useState<CustomerMessageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    if (!customerId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/notifications/deliveries?customerId=${encodeURIComponent(customerId)}&limit=25`);
        const json = (await res.json().catch(() => ({}))) as { deliveries?: CustomerMessageRow[]; migrationPending?: boolean };
        if (!alive) return;
        setRows(json.deliveries ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Falha ao carregar as mensagens.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [customerId]);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-medium">Mensagens enviadas</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Toda notificação deste cliente — planejada, enviada, entregue, lida ou o motivo de não ter saído.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {customerId === undefined ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Sem identificador interno do cliente nesta consulta.</p>
        ) : error ? (
          <p className="text-xs text-red-600 dark:text-red-400 py-4 text-center">{error}</p>
        ) : rows === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Nenhuma mensagem registrada — nada foi enfileirado para este cliente ainda.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 text-xs">
                <span className="w-28 shrink-0 text-muted-foreground">
                  {formatDateTimeBR(row.sentAt ?? row.scheduledFor)}
                </span>
                <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] ${MESSAGE_STATUS_TONE[row.status] ?? "border-border text-muted-foreground"}`}>
                  {MESSAGE_STATUS_LABEL[row.status] ?? row.status}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{row.ruleLabel || "Mensagem manual"}</span>
                  {row.reasonLabel ? <span className="text-muted-foreground"> — {row.reasonLabel}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminCustomer360() {
  const navigate = useNavigate();
  const routeCpf = useParams<{ cpf: string }>().cpf ?? "";

  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [searchCpf, setSearchCpf] = useState(routeCpf);

  // Consulta do cliente (endpoint existente do card "Consultar Cliente")
  const [data, setData] = useState<CustomerLookupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sessões (endpoint existente; filtro local por CPF)
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  // Auditoria do cliente (endpoint existente, scope=customer + cpf)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Lembrete WhatsApp — mesma lógica do dashboard (prévia dryRun + confirmação)
  const [reminderBilling, setReminderBilling] = useState<CustomerLookupResponse["billings"][number] | null>(null);
  const [reminderPreview, setReminderPreview] = useState<ReminderPreview | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderForce, setReminderForce] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);

  // Sessão admin — fluxo idêntico às outras páginas (sem mudança de auth).
  useEffect(() => {
    let cancelled = false;
    adminFetch("/api/admin/verify")
      .then((res) => {
        if (!cancelled) setIsVerified(res.ok);
      })
      .catch(() => {
        if (!cancelled) setIsVerified(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const digits = useMemo(() => routeCpf.replace(/\D/g, ""), [routeCpf]);

  const loadCustomer = useCallback(async () => {
    if (digits.length !== 11) {
      // Rota de entrada (/admin/customers) ou CPF incompleto: não é erro,
      // a tela convida a informar o CPF no formulário acima.
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminFetch(`/api/admin/customer?cpf=${encodeURIComponent(digits)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setData(null);
        setLoadError(json.error || "Cliente não encontrado.");
        return;
      }
      setData(json as CustomerLookupResponse);
    } catch {
      setLoadError("Erro ao consultar o cliente.");
    } finally {
      setLoading(false);
    }
  }, [digits]);

  const loadSessions = useCallback(async () => {
    if (digits.length !== 11) return;
    setSessionsLoading(true);
    try {
      const res = await adminFetch("/api/admin/sessions");
      if (res.ok) {
        const json = await res.json();
        const all: ActiveSession[] = json.sessions || [];
        setSessions(all.filter((s) => (s.cpf || "").replace(/\D/g, "") === digits));
      } else {
        setSessions(null);
      }
    } catch {
      setSessions(null); // seção fica oculta (era o comportamento no dashboard)
    } finally {
      setSessionsLoading(false);
    }
  }, [digits]);

  /** Revogação migrada do dashboard antigo — mesmo endpoint, sem mudança de backend.
   *  Risco MODERADO: o cliente é desconectado na hora e precisa entrar de novo.
   *  ConfirmDialog simples, identificando a sessão afetada. */
  const openRevoke = (sessionId: string) => {
    setRevokeTarget(sessionId);
    setRevokeOpen(true);
  };

  const handleRevokeSession = async () => {
    const sessionId = revokeTarget;
    if (!sessionId) return;

    setRevokingSession(sessionId);
    try {
      const res = await adminFetch("/api/admin/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        toast.success("Sessão revogada", { description: "O cliente foi desconectado." });
        setRevokeOpen(false);
        void loadSessions();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error || "Erro ao revogar sessão.");
      }
    } catch {
      toast.error("Erro ao revogar sessão.");
    } finally {
      setRevokingSession(null);
    }
  };

  const loadAudit = useCallback(async () => {
    if (digits.length !== 11) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const params = new URLSearchParams({ cpf: digits, scope: "customer" });
      const res = await adminFetch(`/api/admin/audit-logs?${params.toString()}`);
      if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      const json: AuditLogsResponse = await res.json();
      setAuditLogs(normalizeAuditLogs((json.logs || []) as AuditLogRow[]));
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Falha ao carregar o histórico do cliente.");
    } finally {
      setAuditLoading(false);
    }
  }, [digits]);

  useEffect(() => {
    if (!isVerified) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão do dashboard original (loadData/loadAuditLogs)
    void loadCustomer();
    void loadSessions();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks estáveis por [digits]; padrão das demais páginas admin
  }, [isVerified]);

  // ── Lembrete WhatsApp (prévia dryRun) — mesma chamada do dashboard ──
  const openReminder = async (billing: CustomerLookupResponse["billings"][number]) => {
    setReminderBilling(billing);
    setReminderPreview(null);
    setReminderForce(false);
    setReminderLoading(true);
    try {
      const res = await adminFetch("/api/admin/notifications/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf: digits,
          billingId: String(billing.id),
          dryRun: true,
          connection: data?.connection?.slug,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReminderBilling(null);
        setLoadError(json.error || "Não foi possível montar a prévia do lembrete.");
        return;
      }
      setReminderPreview(json as ReminderPreview);
    } catch {
      setReminderBilling(null);
      setLoadError("Não foi possível montar a prévia do lembrete.");
    } finally {
      setReminderLoading(false);
    }
  };

  const confirmReminder = async () => {
    if (!reminderBilling) return;
    setReminderSending(true);
    try {
      const res = await adminFetch("/api/admin/notifications/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf: digits,
          billingId: String(reminderBilling.id),
          force: reminderForce,
          connection: data?.connection?.slug,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || "Erro ao enviar o lembrete.");
        return;
      }
      if (json.status === "sent") {
        setLoadError(null);
      }
      setReminderBilling(null);
      void loadAudit(); // o envio fica registrado na auditoria
    } catch {
      setLoadError("Erro ao enviar o lembrete.");
    } finally {
      setReminderSending(false);
    }
  };

  const reminderOptInBlocked =
    reminderPreview?.status === "blocked" && String(reminderPreview?.reason || "").includes("opt-in");
  const reminderCannotSend =
    reminderLoading ||
    !reminderPreview ||
    reminderPreview.status === "already_sent" ||
    (reminderPreview.status === "blocked" && !reminderOptInBlocked) ||
    (reminderOptInBlocked && !reminderForce);

  /**
   * Situação financeira em uma linha — derivada das MESMAS faturas já
   * carregadas (nenhum endpoint novo). Objetivo: o atendente ler a situação do
   * cliente em segundos, antes de rolar a lista.
   *
   * Precisa vir ANTES dos retornos de estado de página (rules-of-hooks).
   */
  const financeSummary = useMemo(() => {
    const billings = data?.billings ?? [];
    const open = billings.filter((b) =>
      ["pendente", "vencido"].includes(mapStatus(b.situation_name || ""))
    );
    const overdue = billings.filter((b) => mapStatus(b.situation_name || "") === "vencido");
    const paid = billings.filter((b) => mapStatus(b.situation_name || "") === "pago");
    const openTotal = open.reduce((acc, b) => acc + (Number(b.value) || 0), 0);
    const overdueTotal = overdue.reduce((acc, b) => acc + (Number(b.value) || 0), 0);

    // Próxima fatura em aberto pela data de vencimento.
    const nextDue = open
      .filter((b) => b.due_day)
      .slice()
      .sort((a, b) => (a.due_day || "").localeCompare(b.due_day || ""))[0];

    return {
      total: billings.length,
      openCount: open.length,
      overdueCount: overdue.length,
      paidCount: paid.length,
      openTotal,
      overdueTotal,
      nextDue,
      tone: overdue.length > 0 ? "danger" : open.length > 0 ? "warning" : "success",
      label:
        overdue.length > 0
          ? `${plural(overdue.length, "fatura em atraso", "faturas em atraso")}`
          : open.length > 0
            ? "Em dia — com faturas em aberto"
            : "Sem faturas em aberto",
    } as const;
  }, [data]);

  // ── Estados de página ──
  if (isVerified === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isVerified === false) {
    return (
      <div className="max-w-6xl mx-auto">
        <Card>
          <ErrorState
            size="page"
            icon={ShieldAlert}
            title="Sessão não encontrada"
            description="Faça login novamente para acessar o painel administrativo."
            action={
              <Button size="sm" className="text-xs" onClick={() => navigate("/admin")}>
                Voltar ao login
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const auditRows: CustomerAuditRow[] = (auditLogs ?? []).map((entry, i) => ({
    key: entry._id ?? String(i),
    entry,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        onBack={() => navigate("/admin/dashboard")}
        backLabel="Voltar ao dashboard"
        icon={UserRoundSearch}
        title={data?.customer?.full_name || (digits.length === 11 ? formatCpf(digits) : "Consultar cliente")}
        description={
          data
            ? [
                data.customer.plan?.name || "Plano não informado",
                data.customer.due_day ? `Vencimento dia ${data.customer.due_day}` : null,
                [data.customer.city, data.customer.state].filter(Boolean).join(", ") || null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Consulta consolidada do cliente."
        }
        badge={
          data?.connection ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-muted-foreground"
              title={`Este cliente pertence à conta MikWeb "${data.connection.label}"`}
            >
              {data.connection.label}
            </span>
          ) : undefined
        }
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Recarregar dados do cliente"
                disabled={loading}
                onClick={() => {
                  void loadCustomer();
                  void loadSessions();
                  void loadAudit();
                }}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar</TooltipContent>
          </Tooltip>
        }
      />

      {/* Busca por outro CPF — navega dentro da mesma rota */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const d = searchCpf.replace(/\D/g, "");
          if (d.length === 11) navigate(`/admin/customers/${d}`);
        }}
      >
        <Input
          value={searchCpf}
          onChange={(e) => setSearchCpf(e.target.value)}
          placeholder="CPF do cliente (11 dígitos)"
          aria-label="Consultar outro CPF"
          className="h-9 text-xs font-mono max-w-xs"
          inputMode="numeric"
        />
        <Button type="submit" size="sm" className="h-9 text-xs shrink-0" disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Consultar
        </Button>
      </form>

      {digits.length !== 11 ? (
        <EmptyState
          icon={UserRoundSearch}
          title="Informe o CPF do cliente"
          description="Digite os 11 dígitos acima para ver faturas, sessões ativas e o histórico do portal."
          size="page"
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError && !data ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar o cliente"
            description={loadError}
            onRetry={() => void loadCustomer()}
            retrying={loading}
          />
        </Card>
      ) : data ? (
        <>
          {/* Situação financeira — leitura rápida antes da lista de faturas */}
          <Card className="border-border shadow-none">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <StatusBadge
                    tone={financeSummary.tone}
                    label={financeSummary.label}
                    className="text-xs font-medium px-2 py-0.5"
                  />
                  <span className="text-xs text-muted-foreground">
                    {plural(financeSummary.paidCount, "paga", "pagas")} ·{" "}
                    {plural(financeSummary.openCount, "em aberto", "em aberto")}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">
                    Total em aberto
                    <strong className="text-foreground ml-1.5 font-medium tabular-nums">
                      {formatBRL(financeSummary.openTotal)}
                    </strong>
                  </span>
                  {financeSummary.overdueTotal > 0 && (
                    <span className="text-muted-foreground">
                      Em atraso
                      <strong className="text-destructive ml-1.5 font-medium tabular-nums">
                        {formatBRL(financeSummary.overdueTotal)}
                      </strong>
                    </span>
                  )}
                  {financeSummary.nextDue && (
                    <span className="text-muted-foreground hidden sm:inline">
                      Próximo vencimento
                      <strong className="text-foreground ml-1.5 font-medium">
                        {formatDueDate(financeSummary.nextDue.due_day || "")}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Faturas (dados do endpoint /api/admin/customer) */}
            <Card className="border-border shadow-none">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium">Faturas</CardTitle>
                  <span className="text-xs font-mono text-muted-foreground">
                    {data.billings.length}
                  </span>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Situação financeira na MikWeb
                  {data.connection ? ` (${data.connection.label})` : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.billings.length === 0 ? (
                  <EmptyState title="Nenhuma fatura encontrada." />
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-1.5">
                    {data.billings.map((b) => (
                      <BillingRow key={b.id} billing={b} onRemind={openReminder} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sessões ativas deste cliente (filtro local sobre /api/admin/sessions) */}
            <Card className="border-border shadow-none">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium">Sessões ativas</CardTitle>
                  {sessions && sessions.length > 0 ? (
                    <span className="text-xs font-mono text-muted-foreground">
                      {sessions.length}
                    </span>
                  ) : null}
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Sessões do portal ligadas a este CPF.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : sessions && sessions.length > 0 ? (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {sessions.map((s) => (
                      <div
                        key={s.sessionId}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-sm border border-border/60 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="text-foreground font-medium truncate">{s.customerName}</p>
                          <p className="text-muted-foreground">
                            última atividade {formatDateTimeBR(s.lastActivityAt)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                          onClick={() => openRevoke(s.sessionId)}
                          disabled={revokingSession === s.sessionId}
                        >
                          {revokingSession === s.sessionId ? (
                            <Loader2 className="h-3 w-3 sm:mr-1 animate-spin" />
                          ) : (
                            <UserX className="h-3 w-3 sm:mr-1" />
                          )}
                          <span className="hidden sm:inline">Revogar</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={Users} title="Nenhuma sessão ativa para este cliente." />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Histórico de auditoria do cliente */}
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium">Histórico no portal</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Eventos de auditoria deste CPF (logins, faturas, cópias de código).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : auditError ? (
                <ErrorState
                  title="Não foi possível carregar o histórico"
                  description={auditError}
                  onRetry={() => void loadAudit()}
                  retrying={auditLoading}
                />
              ) : (
                <DataTable
                  columns={customerAuditColumns}
                  data={auditRows}
                  getRowId={(row) => row.key}
                  pageSize={25}
                  empty={
                    <EmptyState
                      title="Nenhum evento registrado para este CPF."
                      description="Os eventos aparecerão conforme o cliente usar o portal."
                    />
                  }
                />
              )}
            </CardContent>
          </Card>

          <CustomerMessagesCard customerId={data?.customer?.id !== undefined && data?.customer?.id !== null ? String(data.customer.id) : undefined} />
        </>
      ) : null}

      {/* Confirmação do lembrete — mesma prévia do dashboard (dryRun do backend) */}
      <ConfirmDialog
        open={Boolean(reminderBilling)}
        onOpenChange={(open) => {
          if (!open && !reminderSending) {
            setReminderBilling(null);
            setReminderPreview(null);
          }
        }}
        title="Enviar lembrete por WhatsApp?"
        description={
          reminderBilling
            ? `Fatura ${reminderBilling.reference} · vence ${
                reminderBilling.due_day ? formatDueDate(reminderBilling.due_day) : "—"
              } · ${formatBRL(reminderBilling.value ?? 0)}`
            : undefined
        }
        confirmLabel="Enviar lembrete"
        disabled={reminderCannotSend}
        onConfirm={confirmReminder}
      >
        {reminderLoading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            montando a prévia...
          </div>
        ) : reminderPreview ? (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded-sm border border-border">
                destino: {reminderPreview.phoneMasked || "sem celular válido"}
              </span>
              <span
                className={`px-2 py-0.5 rounded-sm border ${
                  reminderPreview.optIn
                    ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/30 text-amber-600 dark:text-amber-400"
                }`}
              >
                opt-in: {reminderPreview.optIn ? "registrado" : "não registrado"}
              </span>
            </div>

            {reminderPreview.status === "already_sent" || reminderPreview.status === "blocked" ? (
              <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{reminderPreview.reason}</span>
              </div>
            ) : null}

            {reminderPreview.preview?.body ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Mensagem que será enviada
                </p>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed rounded-sm border border-border bg-muted/40 p-3 text-foreground max-h-56 overflow-y-auto">
                  {reminderPreview.preview.body}
                </pre>
              </div>
            ) : null}

            {reminderOptInBlocked ? (
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={reminderForce}
                  onCheckedChange={(checked) => setReminderForce(checked === true)}
                  className="mt-0.5 cursor-pointer"
                  aria-label="Enviar mesmo sem opt-in registrado"
                />
                <span className="text-muted-foreground leading-relaxed">
                  Enviar mesmo sem opt-in registrado. A decisão fica registrada na auditoria.
                </span>
              </label>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>

      {/* ── Revogação de sessão (risco moderado) ── */}
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={(open) => {
          setRevokeOpen(open);
          if (!open) setRevokeTarget(null);
        }}
        title="Revogar esta sessão?"
        description="O cliente será desconectado imediatamente e precisará entrar novamente pelo portal."
        confirmLabel="Revogar sessão"
        actionClassName="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={handleRevokeSession}
      >
        {revokeTarget && (sessions ?? [])
          .filter((s) => s.sessionId === revokeTarget)
          .map((s) => (
            <dl key={s.sessionId} className="rounded-sm border border-border bg-secondary/40 divide-y divide-border/60 text-xs">
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground">Cliente</dt>
                <dd className="font-medium truncate">{s.customerName || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground">CPF</dt>
                <dd className="font-mono">{formatCpf(digits)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground">Última atividade</dt>
                <dd>{formatDateTimeBR(s.lastActivityAt)}</dd>
              </div>
            </dl>
          ))}
        <p className="text-muted-foreground">
          Use quando o cliente pedir para sair de um dispositivo que ele não reconhece.
          Revogar a sessão não apaga faturas nem histórico.
        </p>
      </ConfirmDialog>
    </div>
  );
}
