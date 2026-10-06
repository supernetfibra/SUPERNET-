/**
 * Admin Install Requests — Dedicated page for viewing and managing
 * installation requests submitted from the landing page.
 *
 * Features:
 * - Full-page layout with statistics dashboard
 * - Advanced filtering (status, search)
 * - Expandable request cards with full details
 * - Photo gallery with lightbox view
 * - Bulk actions (approve/reject multiple)
 * - Real-time status updates
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Home,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  ChevronDown,
  Phone,
  Mail,
  MapPin,
  Printer,
  MessageSquare,
  Image,
  Download,
  Eye,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { adminFetch } from "@/lib/api-config";
import {
  fetchInstallRequests,
  type InstallRequest,
  type InstallSummary,
} from "@/lib/install-requests-api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, FilterResults, FilterSearch } from "@/components/filter-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatCpf } from "@/lib/cpf";

// ---------------------------------------------------------------------------
// Types — InstallRequest/InstallSummary vêm de
// @/lib/install-requests-api, que normaliza o snake_case do banco.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; tone: StatusTone; icon: typeof Clock }
> = {
  pending: { label: "Pendente", tone: "warning", icon: Clock },
  approved: { label: "Aprovada", tone: "success", icon: CheckCircle2 },
  rejected: { label: "Recusada", tone: "danger", icon: XCircle },
};

// ---------------------------------------------------------------------------
// Admin auth (token + fetch) vem de src/lib/api-config.ts — token via header
// x-admin-token (header-only).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminInstallRequests() {

  // Data state
  const [requests, setRequests] = useState<InstallRequest[]>([]);
  const [summary, setSummary] = useState<InstallSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Decisão em curso (aprovar/recusar) — ver handleStatus
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionTarget, setDecisionTarget] = useState<InstallRequest | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<"approved" | "rejected" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; label: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { requests: list, summary: sum } = await fetchInstallRequests(statusFilter);
      setRequests(list);
      setSummary(sum);
    } catch {
      toast.error("Erro ao carregar solicitações.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregamento de dados (mesmo padrão das demais páginas admin)
    loadRequests();
  }, [loadRequests]);

  // ---------------------------------------------------------------------------
  // Filtered requests
  // ---------------------------------------------------------------------------

  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;

    const q = searchQuery.toLowerCase();
    // Campos numéricos (CPF/telefone) só participam quando a busca tem dígitos:
    // sem essa guarda, q.replace(/\D/g, "") virava "" e includes("") casava com
    // TODOS os registros para qualquer termo textual (bug corrigido na Fase 4).
    const qDigits = q.replace(/\D/g, "");
    return requests.filter((r) => {
      const fullName = (r.fullName || "").toLowerCase();
      const cpf = (r.cpf || "").replace(/\D/g, "");
      const phone = (r.phone || "").replace(/\D/g, "");
      const email = (r.email || "").toLowerCase();
      const city = (r.city || "").toLowerCase();

      return (
        fullName.includes(q) ||
        (qDigits.length > 0 && (cpf.includes(qDigits) || phone.includes(qDigits))) ||
        email.includes(q) ||
        city.includes(q)
      );
    });
  }, [requests, searchQuery]);

  const hasActiveFilter = searchQuery.trim() !== "" || statusFilter !== "all";

  // ---------------------------------------------------------------------------
  // Decisão: aprovar / recusar
  //
  // Risco ALTO. Aprovar libera a instalação E credita pontos do programa de
  // indicação no banco (o backend faz isso de forma idempotente, mas reverter
  // o status depois não desfaz o crédito). Recusar é reversível na teoria, mas
  // não há como o atendente desfazer um clique acidental no card.
  //
  // O endpoint já aceita `adminNote` (coluna admin_note) — usá-lo NÃO é
  // contrato novo, é um parâmetro que existia e nunca era enviado.
  // Aprovar: confirmação simples com identificação do registro.
  // Recusar: confirmação reforçada + motivo (fica registrado).
  // ---------------------------------------------------------------------------

  const openDecision = (request: InstallRequest, status: "approved" | "rejected") => {
    setDecisionTarget(request);
    setDecisionStatus(status);
    setDecisionNote(request.adminNote ?? "");
    setDecisionOpen(true);
  };

  const handleStatus = async () => {
    const request = decisionTarget;
    const status = decisionStatus;
    if (!request || !status) return;

    setProcessingId(request.id);
    try {
      const res = await adminFetch(`/api/admin/install-requests/${request.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          // Motivo obrigatório na recusa; opcional na aprovação.
          adminNote: decisionNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao atualizar.");
        return;
      }
      toast.success(
        status === "approved" ? "Solicitação aprovada" : "Solicitação recusada",
        {
          description:
            status === "approved"
              ? `${request.fullName} — a instalação pode seguir.`
              : `${request.fullName} — motivo registrado.`,
        }
      );
      setDecisionOpen(false);
      void loadRequests();
    } catch {
      toast.error("Erro ao atualizar solicitação.");
    } finally {
      setProcessingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // `created_at`/`reviewed_at` são BIGINT (epoch ms) — ver install-requests-api.
  const formatDate = (epochMs: number) => {
    const d = new Date(epochMs);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  };

  const formatTime = (epochMs: number) => {
    const d = new Date(epochMs);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const getPhotos = (r: InstallRequest) => {
    const photos: { url: string; label: string }[] = [];
    if (r.photoHouseFront) photos.push({ url: r.photoHouseFront, label: "Frente da casa" });
    if (r.photoStreet) photos.push({ url: r.photoStreet, label: "Rua" });
    if (r.photoIdFront) photos.push({ url: r.photoIdFront, label: "Identidade (frente)" });
    if (r.photoIdBack) photos.push({ url: r.photoIdBack, label: "Identidade (verso)" });
    return photos;
  };

  // ---------------------------------------------------------------------------
  // Print helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a printable HTML document and trigger print or PDF download.
   * Uses a hidden iframe to avoid popup blockers.
   */
  const printDocument = (title: string, html: string, mode: "print" | "pdf") => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "0";
    iframe.style.top = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      toast.error("Erro ao preparar documento.");
      iframe.remove();
      return;
    }

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; padding: 20mm; }
          h1 { font-size: 16pt; font-weight: 600; margin-bottom: 8px; text-align: center; }
          h2 { font-size: 12pt; font-weight: 600; margin: 16px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
          .header { text-align: center; margin-bottom: 24px; }
          .header p { font-size: 10pt; color: #666; }
          .field { margin: 4px 0; }
          .field-label { font-weight: 600; display: inline-block; min-width: 120px; }
          .field-value { color: #333; }
          .empty { color: #999; font-style: italic; }
          .section { margin-bottom: 16px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
          .footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 16px; font-size: 9pt; color: #666; text-align: center; }
          .signature { margin-top: 60px; display: flex; justify-content: space-between; }
          .signature-line { width: 200px; border-top: 1px solid #333; text-align: center; padding-top: 4px; font-size: 9pt; }
          @media print { body { padding: 10mm; } }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;

    doc.open();
    doc.write(fullHtml);
    doc.close();

    if (mode === "pdf") {
      // PDF download: open in new tab and let user save as PDF via Ctrl+S or browser menu
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        printWindow.document.title = title;
        // Auto-trigger print dialog so user can choose "Save as PDF"
        setTimeout(() => printWindow.print(), 500);
      } else {
        // Popup blocked — fall back to iframe approach
        setTimeout(() => {
          iframe.contentWindow?.print();
          setTimeout(() => iframe.remove(), 1000);
        }, 300);
      }
      iframe.remove();
    } else {
      // Direct print: use hidden iframe
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 1000);
      }, 300);
    }
  };

  /** Print Terms of Use + Privacy Policy acceptance */
  const printTerms = (r: InstallRequest, mode: "print" | "pdf" = "print") => {
    const html = `
      <div class="header">
        <h1>Termos de Uso e Política de Privacidade</h1>
        <p>Comprovante de Aceite — ${r.fullName}</p>
      </div>

      <div class="section">
        <div class="field"><span class="field-label">Cliente:</span> <span class="field-value">${r.fullName}</span></div>
        <div class="field"><span class="field-label">CPF:</span> <span class="field-value">${r.cpf}</span></div>
        <div class="field"><span class="field-label">Data da solicitação:</span> <span class="field-value">${formatDate(r.createdAt)} às ${formatTime(r.createdAt)}</span></div>
        <div class="field"><span class="field-label">Aceite dos termos:</span> <span class="field-value">${r.agreedToTerms ? 'SIM — O cliente aceitou os Termos de Uso e a Política de Privacidade' : 'NÃO — O cliente NÃO aceitou os termos'}</span></div>
      </div>

      <div class="section">
        <h2>Declaração</h2>
        <p style="text-align: justify; margin-bottom: 12px;">
          Declaro que li e compreendi os <strong>Termos de Uso</strong> e a <strong>Política de Privacidade</strong> do serviço de provedoria de internet, incluindo:
        </p>
        <ul style="margin-left: 20px; margin-bottom: 12px;">
          <li>As condições de contratação e vigência do serviço;</li>
          <li>As obrigações do prestador e do cliente conforme regulamentação da ANATEL;</li>
          <li>As regras de faturamento, pagamento e rescisão;</li>
          <li>A coleta, uso e proteção dos meus dados pessoais conforme a LGPD (Lei nº 13.709/2018);</li>
          <li>Os direitos do titular dos dados, incluindo acesso, correção e exclusão;</li>
          <li>O uso de notificações push para lembretes de faturas.</li>
        </ul>
        <p style="text-align: justify;">
          Estou ciente de que meus dados pessoais (nome, CPF, endereço, telefone, e-mail e fotografias) serão tratados conforme descrito na Política de Privacidade, e que posso exercer meus direitos a qualquer momento através dos canais de atendimento, incluindo o Disque 1331 da ANATEL.
        </p>
      </div>

      <div class="signature">
        <div class="signature-line">Assinatura do Cliente</div>
        <div class="signature-line">Assinatura do Representante</div>
      </div>

      <div class="footer">
        Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} — Sistema de Gestão de Clientes
      </div>
    `;
    printDocument(`Termos de Aceite — ${r.fullName}`, html, mode);
  };

  /** Print client registration/installation request */
  const printRegistration = (r: InstallRequest, mode: "print" | "pdf" = "print") => {
    const html = `
      <div class="header">
        <h1>Cadastro de Cliente — Solicitação de Instalação</h1>
        <p>${r.fullName}</p>
      </div>

      <div class="section">
        <h2>Dados Pessoais</h2>
        <div class="grid">
          <div class="field"><span class="field-label">Nome completo:</span> <span class="field-value">${r.fullName || '<span class="empty">—</span>'}</span></div>
          <div class="field"><span class="field-label">CPF:</span> <span class="field-value">${r.cpf || '<span class="empty">—</span>'}</span></div>
          <div class="field"><span class="field-label">Telefone:</span> <span class="field-value">${r.phone || '<span class="empty">—</span>'}</span></div>
          <div class="field"><span class="field-label">E-mail:</span> <span class="field-value">${r.email || '<span class="empty">Não informado</span>'}</span></div>
        </div>
      </div>

      <div class="section">
        <h2>Endereço</h2>
        <div class="grid">
          <div class="field"><span class="field-label">Rua / Avenida:</span> <span class="field-value">${r.street || '<span class="empty">Não informado</span>'}${r.number ? ', ' + r.number : ''}</span></div>
          <div class="field"><span class="field-label">Complemento:</span> <span class="field-value">${r.complement || '<span class="empty">—</span>'}</span></div>
          <div class="field"><span class="field-label">Bairro:</span> <span class="field-value">${r.neighborhood || '<span class="empty">Não informado</span>'}</span></div>
          <div class="field"><span class="field-label">Cidade/UF:</span> <span class="field-value">${r.city || '<span class="empty">Não informado</span>'}${r.state ? '/' + r.state : ''}</span></div>
          <div class="field"><span class="field-label">CEP:</span> <span class="field-value">${r.zipCode || '<span class="empty">Não informado</span>'}</span></div>
        </div>
      </div>

      <div class="section">
        <h2>Solicitação</h2>
        <div class="field"><span class="field-label">Plano desejado:</span> <span class="field-value">${r.desiredPlan || '<span class="empty">Não informado</span>'}</span></div>
        <div class="field"><span class="field-label">Observação:</span> <span class="field-value">${r.message || '<span class="empty">Nenhuma observação</span>'}</span></div>
        <div class="field"><span class="field-label">Data da solicitação:</span> <span class="field-value">${formatDate(r.createdAt)} às ${formatTime(r.createdAt)}</span></div>
        <div class="field"><span class="field-label">Status:</span> <span class="field-value">${r.status === 'approved' ? 'APROVADA' : r.status === 'rejected' ? 'RECUSADA' : 'PENDENTE'}</span></div>
      </div>

      <div class="signature">
        <div class="signature-line">Assinatura do Cliente</div>
        <div class="signature-line">Assinatura do Técnico</div>
      </div>

      <div class="footer">
        Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} — Sistema de Gestão de Clientes
      </div>
    `;
    printDocument(`Cadastro — ${r.fullName}`, html, mode);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        icon={Home}
        title="Solicitações de Instalação"
        badge={
          summary && summary.pending > 0 ? (
            <Badge
              variant="outline"
              className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400"
            >
              {summary.pending} pendente{summary.pending === 1 ? "" : "s"}
            </Badge>
          ) : undefined
        }
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={loadRequests}
                aria-label="Recarregar solicitações"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar</TooltipContent>
          </Tooltip>
        }
      />

      <div className="space-y-6">
        {/* Statistics */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-[slideUp_0.3s_ease-out]">
            <KpiCard label="Total" value={summary.total} icon={Users} />
            <KpiCard label="Pendentes" value={summary.pending} icon={Clock} tone="warning" />
            <KpiCard label="Aprovadas" value={summary.approved} icon={CheckCircle2} tone="success" />
            <KpiCard label="Recusadas" value={summary.rejected} icon={XCircle} tone="danger" />
          </div>
        )}

        {/* Search and Filter */}
        <FilterBar className="animate-[slideUp_0.3s_ease-out_0.05s_both]">
          <FilterSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Buscar por nome, CPF, telefone, cidade..."
            onClear={() => setSearchQuery("")}
            ariaLabel="Buscar solicitações"
            inputClassName="h-10"
          />
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 w-[140px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                <SelectItem value="pending" className="text-xs">Pendentes</SelectItem>
                <SelectItem value="approved" className="text-xs">Aprovadas</SelectItem>
                <SelectItem value="rejected" className="text-xs">Recusadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </FilterBar>

        {/* Active filter indicator */}
        {hasActiveFilter && (
          <FilterResults
            count={filteredRequests.length}
            unit="resultado"
            onClear={() => { setSearchQuery(""); setStatusFilter("all"); }}
            className="animate-[fadeIn_0.2s_ease-out]"
          />
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredRequests.length === 0 && (
          <EmptyState
            icon={Home}
            size="page"
            title={hasActiveFilter ? "Nenhuma solicitação corresponde aos filtros" : "Nenhuma solicitação recebida"}
            description={hasActiveFilter ? "Tente alterar os filtros de busca" : "As solicitações da página inicial aparecerão aqui"}
          />
        )}

        {/* Request list */}
        {!loading && filteredRequests.length > 0 && (
          <div className="space-y-3">
            {filteredRequests.map((request) => {
              const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
              const StatusIcon = statusConfig.icon;
              const isExpanded = expandedId === request.id;
              const photos = getPhotos(request);

              return (
                <Card
                  key={request.id}
                  className={`border shadow-none transition-all ${
                    isExpanded
                      ? "border-border"
                      : "border-border/60 hover:border-border cursor-pointer"
                  }`}
                  onClick={() => setExpandedId(isExpanded ? null : request.id)}
                >
                  <CardContent className="p-4">
                    {/* Header row — always visible */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-medium text-foreground">
                            {request.fullName}
                          </h3>
                          <StatusBadge
                            tone={statusConfig.tone}
                            icon={StatusIcon}
                            label={statusConfig.label}
                            className="text-[9px] font-medium px-1.5 py-0"
                          />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="font-mono">CPF {formatCpf(request.cpf)}</span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {request.phone}
                          </span>
                          {request.email && (
                            <span className="flex items-center gap-1 hidden sm:flex">
                              <Mail className="h-3 w-3" />
                              {request.email}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {formatDate(request.createdAt)} · {formatTime(request.createdAt)}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-border/60 space-y-4">
                        {/* All fields — always shown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Column 1: Personal data */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              Dados pessoais
                            </h4>
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center gap-2">
                                <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Nome</span>
                                <span className="text-foreground">{request.fullName || <span className="text-muted-foreground italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">CPF</span>
                                <span className="text-foreground font-mono">{formatCpf(request.cpf) || <span className="text-muted-foreground italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Phone className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Telefone</span>
                                <span className="text-foreground">{request.phone || <span className="text-muted-foreground italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">E-mail</span>
                                <span className="text-foreground">{request.email || <span className="text-muted-foreground italic">Não informado</span>}</span>
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Address */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              Endereço
                            </h4>
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Rua</span>
                                <span className="text-foreground">{request.street || <span className="text-muted-foreground italic">Não informado</span>}{request.number ? `, ${request.number}` : ''}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Bairro</span>
                                <span className="text-foreground">{request.neighborhood || <span className="text-muted-foreground italic">Não informado</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Cidade</span>
                                <span className="text-foreground">{request.city || <span className="text-muted-foreground italic">Não informado</span>}{request.state ? `/${request.state}` : ''}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">CEP</span>
                                <span className="text-foreground font-mono">{request.zipCode || <span className="text-muted-foreground italic">Não informado</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Compl.</span>
                                <span className="text-foreground">{request.complement || <span className="text-muted-foreground italic">—</span>}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Full-width fields */}
                        <div className="space-y-3">
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-[60px] sm:w-[68px] shrink-0 font-medium">Plano</span>
                              {request.desiredPlan ? (
                                <Badge variant="outline" className="text-xs font-medium border-border">
                                  {request.desiredPlan}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground italic">Não informado</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-[60px] sm:w-[68px] shrink-0 font-medium">Termos</span>
                              <span className="text-foreground">{request.agreedToTerms ? 'Aceitos' : <span className="text-red-500">Não aceitos</span>}</span>
                            </div>
                          </div>
                        </div>

                        {/* Message */}
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            Observação do cliente
                          </h4>
                          {request.message ? (
                            <p className="text-xs text-foreground italic bg-secondary/30 rounded-sm p-3">
                              &ldquo;{request.message}&rdquo;
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic bg-secondary/30 rounded-sm p-3">
                              Nenhuma observação informada
                            </p>
                          )}
                        </div>

                        {/* Admin note */}
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Nota do admin
                          </h4>
                          {request.adminNote ? (
                            <p className="text-xs text-foreground bg-secondary/30 rounded-sm p-3">
                              {request.adminNote}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic bg-secondary/30 rounded-sm p-3">
                              Nenhuma nota registrada
                            </p>
                          )}
                        </div>

                        {/* Photos */}
                        {photos.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              <Image className="h-3 w-3" />
                              Fotos ({photos.length})
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {photos.map((photo) => (
                                <button
                                  key={photo.label}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLightboxPhoto(photo);
                                  }}
                                  className="group relative"
                                >
                                  <img
                                    src={photo.url}
                                    alt={photo.label}
                                    className="w-full h-28 object-cover rounded-sm border border-border group-hover:opacity-80 transition-opacity"
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-sm">
                                    <Eye className="h-5 w-5 text-white" />
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1 truncate">
                                    {photo.label}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/60">
                          <p className="text-xs text-muted-foreground">
                            Recebida em {formatDate(request.createdAt)} às {formatTime(request.createdAt)}
                          </p>
                          {request.status === "pending" && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDecision(request, "approved");
                                }}
                                disabled={processingId === request.id}
                              >
                                {processingId === request.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                )}
                                Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs text-destructive hover:text-destructive/80 border-destructive/30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDecision(request, "rejected");
                                }}
                                disabled={processingId === request.id}
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                Recusar
                              </Button>
                            </div>
                          )}
                          {request.status !== "pending" && (
                            <div className="flex items-center gap-2">
                              <StatusBadge
                                tone={statusConfig.tone}
                                label={statusConfig.label}
                                className="text-[10px] font-medium px-2 py-0.5"
                              />
                              {request.status === "approved" && (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printTerms(request, "print");
                                    }}
                                  >
                                    <Printer className="h-3 w-3 mr-1" />
                                    Termos
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printTerms(request, "pdf");
                                    }}
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    PDF
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printRegistration(request, "print");
                                    }}
                                  >
                                    <Printer className="h-3 w-3 mr-1" />
                                    Cadastro
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printRegistration(request, "pdf");
                                    }}
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    Cad. PDF
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Photo Lightbox */}
      <Dialog open={!!lightboxPhoto} onOpenChange={() => setLightboxPhoto(null)}>
        <DialogContent className="sm:max-w-3xl p-0 bg-black border-none">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="text-sm font-medium text-white">
              {lightboxPhoto?.label}
            </DialogTitle>
          </DialogHeader>
          {lightboxPhoto && (
            <div className="p-4 pt-2">
              <img
                src={lightboxPhoto.url}
                alt={lightboxPhoto.label}
                className="w-full max-h-[70vh] object-contain rounded-sm"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Decisão: aprovar / recusar (risco alto) ── */}
      <ConfirmDialog
        open={decisionOpen}
        onOpenChange={(open) => {
          setDecisionOpen(open);
          if (!open) setDecisionTarget(null);
        }}
        title={
          decisionStatus === "approved"
            ? "Aprovar esta instalação?"
            : "Recusar esta solicitação?"
        }
        description={
          decisionStatus === "approved"
            ? "A solicitação sai da fila de pendentes e a instalação pode seguir. Se ela veio por indicação, os pontos do indicador são creditados automaticamente."
            : "A solicitação sai da fila de pendentes. O motivo fica registrado nesta tela e não é enviado ao cliente automaticamente."
        }
        confirmLabel={decisionStatus === "approved" ? "Aprovar instalação" : "Recusar solicitação"}
        actionClassName={
          decisionStatus === "approved"
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-red-600 hover:bg-red-700 text-white"
        }
        disabled={
          decisionStatus === "rejected" && decisionNote.trim().length < 3
        }
        onConfirm={handleStatus}
      >
        {decisionTarget && (
          <div className="space-y-3">
            {/* Identificação do registro afetado */}
            <dl className="rounded-sm border border-border bg-secondary/40 divide-y divide-border/60 text-xs">
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground shrink-0">Cliente</dt>
                <dd className="text-foreground font-medium truncate">{decisionTarget.fullName || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground shrink-0">CPF</dt>
                <dd className="text-foreground font-mono">{formatCpf(decisionTarget.cpf)}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground shrink-0">Endereço</dt>
                <dd className="text-foreground text-right min-w-0">
                  {decisionTarget.street ? (
                    <>
                      {decisionTarget.street}
                      {decisionTarget.number ? `, ${decisionTarget.number}` : ""}
                      {decisionTarget.neighborhood ? ` · ${decisionTarget.neighborhood}` : ""}
                      {decisionTarget.city ? ` · ${decisionTarget.city}` : ""}
                      {decisionTarget.state ? `/${decisionTarget.state}` : ""}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">não informado</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground shrink-0">Plano solicitado</dt>
                <dd className="text-foreground truncate">
                  {decisionTarget.desiredPlan || (
                    <span className="text-muted-foreground italic">não informado</span>
                  )}
                </dd>
              </div>
              {decisionStatus === "approved" && decisionTarget.referralCode && (
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <dt className="text-muted-foreground shrink-0">Indicação</dt>
                  <dd className="text-foreground font-mono">{decisionTarget.referralCode}</dd>
                </div>
              )}
            </dl>

            {/* Motivo — obrigatório na recusa, opcional na aprovação */}
            <div className="space-y-1.5">
              <Label
                htmlFor="decision-note"
                className="text-xs text-foreground flex items-center gap-1.5"
              >
                {decisionStatus === "approved" ? "Observação (opcional)" : "Motivo da recusa"}
                {decisionStatus === "rejected" ? (
                  <span className="text-destructive text-xs font-normal">obrigatório</span>
                ) : null}
              </Label>
              <Textarea
                id="decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={
                  decisionStatus === "approved"
                    ? "Ex.: cobertura confirmada, instalação agendada para sexta."
                    : "Ex.: endereço fora da área de cobertura."
                }
                className="text-xs min-h-[68px]"
                maxLength={280}
              />
              {decisionStatus === "rejected" && decisionNote.trim().length < 3 ? (
                <p className="text-xs text-destructive">
                  Escreva o motivo antes de recusar — é o que orienta a reavaliação.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Fica registrado na solicitação e aparece na impressão.
                </p>
              )}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
