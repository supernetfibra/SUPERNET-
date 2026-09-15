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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  MapPin,
  Printer,
  Calendar,
  MessageSquare,
  Image,
  Download,
  Eye,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-config";
import { formatCpf } from "@/lib/cpf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstallRequest {
  id: string;
  fullName: string;
  cpf: string;
  phone: string;
  email?: string;
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  desiredPlan?: string;
  message?: string;
  agreedToTerms?: boolean;
  status: "pending" | "approved" | "rejected";
  adminNote?: string;
  photoHouseFront?: string;
  photoStreet?: string;
  photoIdFront?: string;
  photoIdBack?: string;
  createdAt: string;
  updatedAt?: string;
}

interface InstallSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  pending: {
    label: "Pendente",
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400",
    icon: Clock,
  },
  approved: {
    label: "Aprovada",
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Recusada",
    color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400",
    icon: XCircle,
  },
};

// ---------------------------------------------------------------------------
// Admin token helper
// ---------------------------------------------------------------------------

function getAdminToken(): string | null {
  try {
    return localStorage.getItem("mikweb_admin_token");
  } catch {
    return null;
  }
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const url = new URL(apiUrl(path));
  if (token) {
    url.searchParams.set("token", token);
  }
  return fetch(url.toString(), {
    ...init,
    credentials: "include",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminInstallRequests() {
  const navigate = useNavigate();

  // Data state
  const [requests, setRequests] = useState<InstallRequest[]>([]);
  const [summary, setSummary] = useState<InstallSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

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
      const params = new URLSearchParams();
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      const res = await adminFetch(`/api/admin/install-requests?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
        setSummary(data.summary || null);
      } else {
        toast.error("Erro ao carregar solicitações.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // ---------------------------------------------------------------------------
  // Filtered requests
  // ---------------------------------------------------------------------------

  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;

    const q = searchQuery.toLowerCase();
    return requests.filter((r) => {
      const fullName = (r.fullName || "").toLowerCase();
      const cpf = (r.cpf || "").replace(/\D/g, "");
      const phone = (r.phone || "").replace(/\D/g, "");
      const email = (r.email || "").toLowerCase();
      const city = (r.city || "").toLowerCase();

      return (
        fullName.includes(q) ||
        cpf.includes(q.replace(/\D/g, "")) ||
        phone.includes(q.replace(/\D/g, "")) ||
        email.includes(q) ||
        city.includes(q)
      );
    });
  }, [requests, searchQuery]);

  const hasActiveFilter = searchQuery.trim() !== "" || statusFilter !== "all";

  // ---------------------------------------------------------------------------
  // Status update
  // ---------------------------------------------------------------------------

  const handleStatus = async (requestId: string, status: "approved" | "rejected") => {
    setProcessingId(requestId);
    try {
      const res = await adminFetch(`/api/admin/install-requests/${requestId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao atualizar.");
        return;
      }
      toast.success(
        status === "approved" ? "Solicitação aprovada" : "Solicitação recusada",
        { description: "Status atualizado com sucesso." }
      );
      loadRequests();
    } catch {
      toast.error("Erro ao atualizar solicitação.");
    } finally {
      setProcessingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const buildAddress = (r: InstallRequest) => {
    const parts = [
      r.street && `${r.street}${r.number ? `, ${r.number}` : ""}`,
      r.complement,
      r.neighborhood,
      r.city && r.state ? `${r.city}/${r.state}` : r.city || r.state,
    ].filter(Boolean);
    return parts.join(", ") || null;
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
   * Generate a printable HTML document and trigger the browser print dialog.
   * Opens in a new window so the admin can print without leaving the page.
   */
  const printDocument = (title: string, html: string) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Bloqueado pelo popup. Permita popups para imprimir.");
      return;
    }
    printWindow.document.write(`
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
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  /** Print Terms of Use + Privacy Policy acceptance */
  const printTerms = (r: InstallRequest) => {
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
    printDocument(`Termos de Aceite — ${r.fullName}`, html);
  };

  /** Print client registration/installation request */
  const printRegistration = (r: InstallRequest) => {
    const address = buildAddress(r);
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
    printDocument(`Cadastro — ${r.fullName}`, html);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-xl font-medium tracking-tight text-foreground">
            Solicitações de Instalação
          </h1>
          {summary && summary.pending > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400"
            >
              {summary.pending} pendente{summary.pending === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <button
          onClick={loadRequests}
          className="text-muted-foreground hover:text-foreground transition-colors"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="space-y-6">
        {/* Statistics */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-[slideUp_0.3s_ease-out]">
            <Card className="border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{summary.total}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{summary.pending}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pendentes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{summary.approved}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aprovadas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                    <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{summary.rejected}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recusadas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3 animate-[slideUp_0.3s_ease-out_0.05s_both]">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por nome, CPF, telefone, cidade..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 pl-10 pr-10 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
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
        </div>

        {/* Active filter indicator */}
        {hasActiveFilter && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-[fadeIn_0.2s_ease-out]">
            <span>{filteredRequests.length} resultado{filteredRequests.length !== 1 ? "s" : ""}</span>
            <button
              onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
              className="text-foreground hover:underline"
            >
              Limpar filtros
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredRequests.length === 0 && (
          <div className="text-center py-16">
            <Home className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">
              {hasActiveFilter ? "Nenhuma solicitação corresponde aos filtros" : "Nenhuma solicitação recebida"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilter ? "Tente alterar os filtros de busca" : "As solicitações da página inicial aparecerão aqui"}
            </p>
          </div>
        )}

        {/* Request list */}
        {!loading && filteredRequests.length > 0 && (
          <div className="space-y-3">
            {filteredRequests.map((request) => {
              const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
              const StatusIcon = statusConfig.icon;
              const isExpanded = expandedId === request.id;
              const address = buildAddress(request);
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
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-medium px-1.5 py-0 border-none ${statusConfig.color}`}
                          >
                            <StatusIcon className="h-2.5 w-2.5 mr-1" />
                            {statusConfig.label}
                          </Badge>
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
                        <span className="text-[10px] text-muted-foreground hidden sm:block">
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
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Dados pessoais
                            </h4>
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center gap-2">
                                <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Nome</span>
                                <span className="text-foreground">{request.fullName || <span className="text-muted-foreground/50 italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">CPF</span>
                                <span className="text-foreground font-mono">{formatCpf(request.cpf) || <span className="text-muted-foreground/50 italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Phone className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Telefone</span>
                                <span className="text-foreground">{request.phone || <span className="text-muted-foreground/50 italic">—</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">E-mail</span>
                                <span className="text-foreground">{request.email || <span className="text-muted-foreground/50 italic">Não informado</span>}</span>
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Address */}
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Endereço
                            </h4>
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="text-muted-foreground w-16 shrink-0">Rua</span>
                                <span className="text-foreground">{request.street || <span className="text-muted-foreground/50 italic">Não informado</span>}{request.number ? `, ${request.number}` : ''}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Bairro</span>
                                <span className="text-foreground">{request.neighborhood || <span className="text-muted-foreground/50 italic">Não informado</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Cidade</span>
                                <span className="text-foreground">{request.city || <span className="text-muted-foreground/50 italic">Não informado</span>}{request.state ? `/${request.state}` : ''}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">CEP</span>
                                <span className="text-foreground font-mono">{request.zipCode || <span className="text-muted-foreground/50 italic">Não informado</span>}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="text-muted-foreground w-16 shrink-0">Compl.</span>
                                <span className="text-foreground">{request.complement || <span className="text-muted-foreground/50 italic">—</span>}</span>
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
                                <Badge variant="outline" className="text-[10px] font-medium border-border">
                                  {request.desiredPlan}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground/50 italic">Não informado</span>
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
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            Observação do cliente
                          </h4>
                          {request.message ? (
                            <p className="text-xs text-foreground italic bg-secondary/30 rounded-sm p-3">
                              &ldquo;{request.message}&rdquo;
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/50 italic bg-secondary/30 rounded-sm p-3">
                              Nenhuma observação informada
                            </p>
                          )}
                        </div>

                        {/* Admin note */}
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Nota do admin
                          </h4>
                          {request.adminNote ? (
                            <p className="text-xs text-foreground bg-secondary/30 rounded-sm p-3">
                              {request.adminNote}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/50 italic bg-secondary/30 rounded-sm p-3">
                              Nenhuma nota registrada
                            </p>
                          )}
                        </div>

                        {/* Photos */}
                        {photos.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
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
                                  <p className="text-[9px] text-muted-foreground mt-1 truncate">
                                    {photo.label}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/60">
                          <p className="text-[10px] text-muted-foreground">
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
                                  handleStatus(request.id, "approved");
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
                                  handleStatus(request.id, "rejected");
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
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-medium px-2 py-0.5 border-none ${statusConfig.color}`}
                              >
                                {statusConfig.label}
                              </Badge>
                              {request.status === "approved" && (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[10px] text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printTerms(request);
                                    }}
                                  >
                                    <Printer className="h-3 w-3 mr-1" />
                                    Termos
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[10px] text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      printRegistration(request);
                                    }}
                                  >
                                    <Printer className="h-3 w-3 mr-1" />
                                    Cadastro
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
    </div>
  );
}
