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
  _id: string;
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
              const isExpanded = expandedId === request._id;
              const address = buildAddress(request);
              const photos = getPhotos(request);

              return (
                <Card
                  key={request._id}
                  className={`border shadow-none transition-all ${
                    isExpanded
                      ? "border-border"
                      : "border-border/60 hover:border-border cursor-pointer"
                  }`}
                  onClick={() => setExpandedId(isExpanded ? null : request._id)}
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
                        {/* Contact info */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Dados pessoais
                            </h4>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Users className="h-3 w-3 shrink-0" />
                                <span>{request.fullName}</span>
                              </div>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <span className="h-3 w-3 shrink-0" />
                                <span className="font-mono">CPF {formatCpf(request.cpf)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Phone className="h-3 w-3 shrink-0" />
                                <span>{request.phone}</span>
                              </div>
                              {request.email && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Mail className="h-3 w-3 shrink-0" />
                                  <span>{request.email}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Endereço
                            </h4>
                            {address ? (
                              <div className="space-y-1.5 text-xs text-muted-foreground">
                                <div className="flex items-start gap-2">
                                  <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                  <div>
                                    <p>{address}</p>
                                    {request.zipCode && (
                                      <p className="text-[10px]">CEP: {request.zipCode}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Não informado</p>
                            )}

                            {request.desiredPlan && (
                              <div className="mt-2">
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                  Plano desejado
                                </h4>
                                <Badge variant="outline" className="text-[10px] font-medium border-border">
                                  {request.desiredPlan}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Message */}
                        {request.message && (
                          <div className="space-y-1">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              Observação do cliente
                            </h4>
                            <p className="text-xs text-muted-foreground italic bg-secondary/30 rounded-sm p-3">
                              &ldquo;{request.message}&rdquo;
                            </p>
                          </div>
                        )}

                        {/* Admin note */}
                        {request.adminNote && (
                          <div className="space-y-1">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Nota do admin
                            </h4>
                            <p className="text-xs text-muted-foreground bg-secondary/30 rounded-sm p-3">
                              {request.adminNote}
                            </p>
                          </div>
                        )}

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
                                  handleStatus(request._id, "approved");
                                }}
                                disabled={processingId === request._id}
                              >
                                {processingId === request._id ? (
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
                                  handleStatus(request._id, "rejected");
                                }}
                                disabled={processingId === request._id}
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                Recusar
                              </Button>
                            </div>
                          )}
                          {request.status !== "pending" && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-medium px-2 py-0.5 border-none ${statusConfig.color}`}
                            >
                              {statusConfig.label}
                            </Badge>
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
