/**
 * Admin Audit — página dedicada de Auditoria (Fase 4, ETAPA 4.4).
 *
 * Origem: o "Histórico de Acessos" e as "Estatísticas Gerais" viviam dentro do
 * AdminDashboard e foram movidos para cá sem mudar endpoints, filtros ou
 * regras. Usa a infraestrutura da Fase 3: PageHeader, FilterBar/Tabs, DataTable
 * com paginação client-side (50/página), StatusBadge, EmptyState e ErrorState.
 *
 * Endpoint: GET /api/admin/audit-logs (o mesmo do dashboard — nenhum backend
 * novo). Filtros: tipo, escopo (clientes × operação) e CPF — o mesmo conjunto
 * que existia no dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ShieldAlert,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import type { DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FilterBar, FilterSearch } from "@/components/filter-bar";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/components/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminFetch } from "@/lib/api-config";
import {
  auditTypeLabels,
  CUSTOMER_AUDIT_TYPES,
  formatBRL,
  normalizeAuditLogs,
  systemEventSubtitle,
  type AuditEntry,
  type AuditLogRow,
} from "@/lib/audit-shared";

/** 000.000.000-00 */
function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

type AuditRow = AuditEntry & { key: string };

const auditColumns: DataTableColumn<AuditRow>[] = [
  {
    key: "type",
    header: "Evento",
    render: (row) => {
      const info = auditTypeLabels[row.type] || { label: row.type, tone: "neutral" as StatusTone };
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
    key: "who",
    header: "Cliente",
    render: (row) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {row.customerName ? (
            <span className="text-foreground font-medium truncate">
              {row.customerName}
            </span>
          ) : row.cpf ? (
            <span className="text-foreground font-medium truncate">Cliente</span>
          ) : (
            <span className="text-muted-foreground italic">Sistema</span>
          )}
        </div>
        {row.cpf ? (
          <span className="text-xs text-muted-foreground font-mono">
            CPF {formatCpf(row.cpf)}
          </span>
        ) : null}
      </div>
    ),
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
    className: "min-w-[320px] whitespace-normal",
    render: (row) => {
      const lines: string[] = [];
      if (row.errorMessage) lines.push(row.errorMessage);
      const subtitle = systemEventSubtitle(row);
      if (!row.errorMessage && subtitle) lines.push(subtitle);
      if (row.metadata?.reference) {
        lines.push(
          `Fatura ${row.metadata.reference}${
            typeof row.metadata.value === "number"
              ? ` · ${formatBRL(row.metadata.value)}`
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
    key: "ip",
    header: "IP",
    hideBelow: "md",
    className: "font-mono text-xs text-muted-foreground",
    render: (row) => row.ipAddress || "—",
  },
  {
    key: "timestamp",
    header: "Data / Hora",
    sortValue: (row) => row.timestamp,
    className: "whitespace-nowrap text-xs text-muted-foreground",
    render: (row) => {
      const date = new Date(row.timestamp);
      return (
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {date.toLocaleDateString("pt-BR")}
          </p>
          <p className="text-xs text-muted-foreground">
            {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      );
    },
  },
];

export default function AdminAudit() {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros — o mesmo conjunto suportado pelo endpoint antes da Fase 4.
  const [typeFilter, setTypeFilter] = useState("all");
  const [cpfFilter, setCpfFilter] = useState("");
  const [scope, setScope] = useState<"customer" | "system">("customer");

  // Verificação de sessão — mesmo fluxo das outras páginas admin (nenhuma
  // mudança de autenticação: token local + /api/admin/verify; falha = logout).
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

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLogsLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (cpfFilter.trim()) params.set("cpf", cpfFilter.replace(/\D/g, ""));
        params.set("scope", scope);
        const res = await adminFetch(`/api/admin/audit-logs?${params.toString()}`);
        if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
        const data = await res.json();
        const mapped = normalizeAuditLogs((data.logs || []) as AuditLogRow[]);
        setLogs(mapped.map((entry) => ({ ...entry, key: entry._id })));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Falha ao carregar o histórico.");
      } finally {
        if (!silent) setLogsLoading(false);
      }
    },
    [typeFilter, cpfFilter, scope],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão do AdminDashboard original (loadAuditLogs)
    if (isVerified) void loadLogs();
  }, [isVerified, loadLogs]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadLogs(true).finally(() => setRefreshing(false));
  };

  const rows: AuditRow[] = useMemo(
    () => logs.map((l, i) => ({ ...(l as AuditRow), key: (l as AuditRow).key ?? String(i) })),
    [logs],
  );

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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        icon={Activity}
        title="Auditoria"
        description="Acessos e eventos de operação do portal — quem fez o quê, quando. Clique numa linha para abrir o Cliente 360."
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRefresh}
                aria-label="Atualizar auditoria"
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar</TooltipContent>
          </Tooltip>
        }
      />

      {/* Filtros — mesma interação do dashboard (Tabs de escopo + Select de tipo + CPF) */}
      <FilterBar>
        <FilterSearch
          value={cpfFilter}
          onChange={setCpfFilter}
          placeholder="Filtrar por CPF (apenas escopo Clientes)..."
          ariaLabel="Filtrar por CPF"
          inputClassName="h-8 text-xs font-mono"
          onClear={() => setCpfFilter("")}
        />
        {scope === "customer" ? (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-[150px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_AUDIT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Tabs value={scope} onValueChange={(v) => setScope(v as "customer" | "system")}>
          <TabsList className="h-8">
            <TabsTrigger value="customer" className="text-xs px-3">Clientes</TabsTrigger>
            <TabsTrigger value="system" className="text-xs px-3">Operação</TabsTrigger>
          </TabsList>
        </Tabs>
      </FilterBar>

      {logsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar a auditoria"
            description={loadError}
            onRetry={() => void loadLogs()}
            retrying={logsLoading}
          />
        </Card>
      ) : (
        <DataTable
          columns={auditColumns}
          data={rows}
          getRowId={(row) => row.key}
          pageSize={50}
          stickyHeader
          containerClassName="max-h-[560px] overflow-y-auto"
          // O log é onde o atendente vê o cliente: clicar na linha abre o
          // Cliente 360. Torna o 360 descobrível sem criar um destino novo no menu.
          onRowClick={(row) => {
            if (row.cpf) navigate(`/admin/customers/${row.cpf.replace(/\D/g, "")}`);
          }}
          empty={
            <EmptyState
              icon={Activity}
              size="page"
              title="Nenhum registro encontrado."
              description="Os registros aparecerão aqui conforme clientes acessarem o portal."
            />
          }
        />
      )}
    </div>
  );
}
