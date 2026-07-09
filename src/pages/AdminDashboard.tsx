/**
 * Admin Dashboard — API configuration, connection test,
 * and audit log viewer (login attempts, errors, etc.).
 *
 * Passes the admin session token via query params as a fallback for
 * when Secure cookies are rejected by the browser (HTTP dev env).
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Activity,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  LogOut,
  Wifi,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldAlert,
  UserX,
  Image,
  Type,
  Upload,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Token helper — reads from localStorage and appends as query param
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";
const BRANDING_STORAGE_KEY = "mikweb_branding";
const CONFIG_STORAGE_KEY = "mikweb_api_config";

function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function getStoredBranding(): { providerName: string; logoUrl: string } | null {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeBranding(name: string, logo: string) {
  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ providerName: name, logoUrl: logo }));
  } catch {
    // localStorage may be full or unavailable
  }
}

function getStoredConfig(): { apiUrl: string; apiToken: string } | null {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeConfig(apiUrl: string, apiToken: string) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ apiUrl, apiToken }));
  } catch {
    // localStorage may be full or unavailable
  }
}

/** Append ?token=... to a URL for admin API calls */
function withAdminToken(url: string): string {
  const token = getAdminToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(withAdminToken(url), { ...init, credentials: "include" });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  _id: string;
  type: string;
  cpf?: string;
  customerName?: string;
  errorMessage?: string;
  ipAddress?: string;
  timestamp: number;
}

interface AuditSummary {
  totalLogins: number;
  totalFailures: number;
  totalRateLimited: number;
  totalBillingErrors: number;
  todayLogins: number;
  todayFailures: number;
  last7DaysLogins: number;
  last7DaysFailures: number;
  uniqueCpfs: number;
}

const typeLabels: Record<string, { label: string; color: string }> = {
  login_success: { label: "Login OK", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400" },
  login_failure: { label: "Falha Login", color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400" },
  login_rate_limited: { label: "Rate Limit", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400" },
  billing_error: { label: "Erro Fatura", color: "text-orange-600 bg-orange-50 dark:bg-orange-950/20 dark:text-orange-400" },
  billing_access: { label: "Acesso Fatura", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400" },
  logout: { label: "Logout", color: "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400" },
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  // Config form
  const [apiUrl, setApiUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Test connection
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Branding
  const [providerName, setProviderName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoInput, setLogoInput] = useState("");
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);

  // Audit log
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logFilter, setLogFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  // Verify admin session on mount — show an "expired" screen instead of
  // navigating away, to avoid redirect loops.
  useEffect(() => {
    let cancelled = false;

    adminFetch("/api/admin/verify")
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setIsVerified(true);
        } else {
          setIsVerified(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsVerified(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Load config and audit data
  const loadData = useCallback(async () => {
    if (!isVerified) return;

    try {
      // Try loading API config from the server
      let loadedConfig = false;
      try {
        const configRes = await adminFetch("/api/admin/config");
        if (configRes.ok) {
          const config = await configRes.json();
          if (config.apiUrl) {
            setApiUrl(config.apiUrl);
            // Token comes masked from server (only first/last 4 chars)
            // Only restore token from localStorage if server has one
            if (config.hasToken) {
              const stored = getStoredConfig();
              if (stored?.apiToken) {
                setApiToken(stored.apiToken);
              }
            }
            storeConfig(config.apiUrl, "");
            loadedConfig = true;
          }
        }
      } catch {
        // Server unavailable — fall through to localStorage
      }

      // Fallback to localStorage if server failed
      if (!loadedConfig) {
        const stored = getStoredConfig();
        if (stored) {
          setApiUrl(stored.apiUrl);
          setApiToken(stored.apiToken);
        }
      }

      // Try loading branding from the server
      let loadedBranding = false;
      try {
        const brandingRes = await adminFetch("/api/admin/branding");
        if (brandingRes.ok) {
          const branding = await brandingRes.json();
          if (branding.providerName) {
            setProviderName(branding.providerName);
            setLogoUrl(branding.logoUrl || "");
            setLogoInput(branding.logoUrl || "");
            // Sync to localStorage
            storeBranding(branding.providerName, branding.logoUrl || "");
            loadedBranding = true;
          }
        }
      } catch {
        // Server unavailable — fall through to localStorage
      }

      // Fallback to localStorage if server failed
      if (!loadedBranding) {
        const stored = getStoredBranding();
        if (stored) {
          setProviderName(stored.providerName);
          setLogoUrl(stored.logoUrl);
          setLogoInput(stored.logoUrl);
        }
      }
    } catch {
      // Config endpoint might not exist as HTTP; data is loaded via Convex
    }

    await loadAuditLogs();
  }, [isVerified]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadAuditLogs = async (type?: string) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (type && type !== "all") params.set("type", type);

      const res = await adminFetch(
        `/api/admin/audit-logs?${params.toString()}`
      );
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setAuditSummary(data.summary || null);
      }
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs(logFilter);
  }, [logFilter, isVerified]);

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigSaved(false);

    // Always save to localStorage first for immediate persistence
    storeConfig(apiUrl, apiToken);
    setConfigSaved(true);

    // Then try the server — if it fails, the data is still persisted locally
    try {
      const res = await adminFetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken }),
      });

      if (!res.ok) {
        console.warn("API config saved to localStorage only; server rejected:", await res.text());
      } else {
        setConnectionResult(null);
      }
    } catch {
      console.warn("API config saved to localStorage only; server unavailable.");
    } finally {
      setConfigSaving(false);
      setTimeout(() => setConfigSaved(false), 3000);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);

    try {
      const res = await adminFetch("/api/admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken }),
      });

      const data = await res.json();
      setConnectionResult(data);
    } catch {
      setConnectionResult({
        success: false,
        message: "Erro ao conectar com o servidor.",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminFetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Ignore logout API errors
    }
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    navigate("/");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAuditLogs(logFilter).finally(() => setRefreshing(false));
  };

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingError(null);
    setBrandingSaved(false);

    // Always save to localStorage first for immediate persistence
    storeBranding(providerName, logoInput);
    setLogoUrl(logoInput);
    setBrandingSaved(true);

    // Then try the server — if it fails, the data is still persisted locally
    try {
      const res = await adminFetch("/api/admin/branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, logoUrl: logoInput }),
      });

      if (!res.ok) {
        console.warn("Branding saved to localStorage only; server rejected:", await res.text());
      }
    } catch {
      console.warn("Branding saved to localStorage only; server unavailable.");
    } finally {
      setBrandingSaving(false);
      setTimeout(() => setBrandingSaved(false), 3000);
    }
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setLogoInput(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoInput("");
    setLogoUrl("");
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (isVerified === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Verificando sessão...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Session expired / not found
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Summary cards data
  // ---------------------------------------------------------------------------
  const summaryCards = auditSummary
    ? [
        {
          label: "Logins (hoje)",
          value: auditSummary.todayLogins,
          icon: Users,
          color: "text-emerald-500",
        },
        {
          label: "Falhas (hoje)",
          value: auditSummary.todayFailures,
          icon: UserX,
          color: "text-red-500",
        },
        {
          label: "Logins (7 dias)",
          value: auditSummary.last7DaysLogins,
          icon: Activity,
          color: "text-blue-500",
        },
        {
          label: "CPFs únicos",
          value: auditSummary.uniqueCpfs,
          icon: Users,
          color: "text-foreground",
        },
      ]
    : [];

  // ---------------------------------------------------------------------------
  // Main dashboard
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12 px-4 animate-[fadeIn_0.3s_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">
            Administração
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure a integração com a API MikWeb e acompanhe o histórico de acessos.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-3.5 w-3.5 mr-1.5" />
          Sair
        </Button>
      </div>

      {/* Summary Cards */}
      {auditSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <Card key={card.label} className="border-border shadow-none animate-[slideUp_0.3s_ease-out]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                  <div>
                    <p className="text-lg font-light tracking-tight text-foreground">
                      {card.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{card.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Branding Section */}
        <div className="lg:col-span-2 animate-[slideUp_0.3s_ease-out_0.1s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Image className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  Marca do Provedor
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Personalize o nome e a logo da sua provedora.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="provider-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Nome do Provedor
                </Label>
                <Input
                  id="provider-name"
                  type="text"
                  placeholder="Minha Provedora"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  Logo (URL ou upload)
                </Label>
                <Input
                  type="url"
                  placeholder="https://exemplo.com/logo.png"
                  value={logoInput}
                  onChange={(e) => setLogoInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="logo-upload"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                  >
                    <Upload className="h-3 w-3" />
                    Upload imagem
                  </Label>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleLogoFile}
                  />
                  {logoInput && (
                    <button
                      onClick={handleRemoveLogo}
                      className="text-xs text-destructive hover:text-destructive/80 transition-colors"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              {/* Preview */}
              {logoInput && (
                <div className="flex items-center gap-3 p-3 rounded-sm border border-border bg-secondary/30">
                  {logoInput.startsWith("data:") || logoInput.startsWith("http") ? (
                    <img
                      src={logoInput}
                      alt="Preview"
                      className="h-10 w-10 object-contain rounded-sm"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-sm bg-secondary flex items-center justify-center">
                      <Wifi className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    <span className="text-foreground font-medium">{providerName || "Provedora"}</span>
                    <p>Pré-visualização da marca</p>
                  </div>
                </div>
              )}

              {brandingError && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{brandingError}</span>
                </p>
              )}

              <Button
                variant="default"
                size="sm"
                className="w-full text-xs h-9"
                onClick={handleSaveBranding}
                disabled={brandingSaving || !providerName.trim()}
              >
                {brandingSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : brandingSaved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Type className="h-3.5 w-3.5 mr-1.5" />
                )}
                {brandingSaved ? "Salvo!" : "Salvar marca"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* API Config */}
        <div className="lg:col-span-2 animate-[slideUp_0.3s_ease-out_0.15s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  Configuração da API
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Configure a URL e o token de acesso à API do MikWeb.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="api-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  URL da API
                </Label>
                <Input
                  id="api-url"
                  type="url"
                  placeholder="https://seu-mikweb.com.br/api"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="api-token"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Token de autenticação
                </Label>
                <div className="relative">
                  <Input
                    id="api-token"
                    type={showToken ? "text" : "password"}
                    placeholder="Bearer token"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    className="h-9 text-xs font-mono pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showToken ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {configError && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{configError}</span>
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-9"
                  onClick={handleTestConnection}
                  disabled={testingConnection || !apiUrl || !apiToken}
                >
                  {testingConnection ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Testar conexão
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1 text-xs h-9"
                  onClick={handleSaveConfig}
                  disabled={configSaving || !apiUrl || !apiToken}
                >
                  {configSaving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : configSaved ? (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <Settings className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {configSaved ? "Salvo!" : "Salvar"}
                </Button>
              </div>

              {/* Connection test result */}
              {connectionResult && (
                <div
                  className={`flex items-start gap-2 text-xs p-3 rounded-sm border ${
                    connectionResult.success
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300"
                      : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20 text-red-700 dark:text-red-300"
                  }`}
                >
                  {connectionResult.success ? (
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  )}
                  <span>{connectionResult.message}</span>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                As variáveis de ambiente MIKWEB_API_URL e MIKWEB_API_TOKEN têm
                prioridade sobre a configuração salva aqui.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Audit Log */}
        <div className="lg:col-span-3 animate-[slideUp_0.3s_ease-out_0.2s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">
                    Histórico de Acessos
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={logFilter}
                    onValueChange={(v) => setLogFilter(v)}
                  >
                    <SelectTrigger className="h-7 text-[10px] w-[120px]">
                      <SelectValue placeholder="Filtrar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">
                        Todos
                      </SelectItem>
                      <SelectItem value="login_success" className="text-xs">
                        Logins OK
                      </SelectItem>
                      <SelectItem value="login_failure" className="text-xs">
                        Falhas
                      </SelectItem>
                      <SelectItem value="login_rate_limited" className="text-xs">
                        Rate Limit
                      </SelectItem>
                      <SelectItem value="billing_error" className="text-xs">
                        Erros Fatura
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={handleRefresh}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    disabled={refreshing}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12">
                  <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum registro encontrado.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Os registros aparecerão aqui conforme clientes acessarem o portal.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                  {auditLogs.map((entry) => {
                    const typeInfo = typeLabels[entry.type] || {
                      label: entry.type,
                      color: "text-gray-500 bg-gray-50",
                    };
                    const date = new Date(entry.timestamp);

                    return (
                      <div
                        key={entry._id}
                        className="flex items-center gap-3 px-3 py-2 rounded-sm hover:bg-secondary/30 transition-colors text-xs"
                      >
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-medium px-1.5 py-0 border-none shrink-0 ${typeInfo.color}`}
                        >
                          {typeInfo.label}
                        </Badge>

                        <div className="flex-1 min-w-0">
                          {entry.customerName && (
                            <span className="text-foreground font-medium truncate block">
                              {entry.customerName}
                            </span>
                          )}
                          {entry.cpf && (
                            <span className="text-muted-foreground">
                              CPF: ***{entry.cpf.slice(-3)}
                            </span>
                          )}
                          {entry.errorMessage && (
                            <span className="text-muted-foreground block truncate">
                              {entry.errorMessage}
                            </span>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-muted-foreground">
                            {date.toLocaleDateString("pt-BR")}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {date.toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>

                        {entry.ipAddress && (
                          <span className="text-[10px] text-muted-foreground font-mono hidden sm:block">
                            {entry.ipAddress}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Total Stats */}
      {auditSummary && (
        <div className="animate-[slideUp_0.3s_ease-out_0.25s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Estatísticas Gerais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-2xl font-light text-foreground">
                    {auditSummary.totalLogins}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Logins bem-sucedidos
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-light text-foreground">
                    {auditSummary.totalFailures}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tentativas com falha
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-light text-foreground">
                    {auditSummary.totalRateLimited}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bloqueios por rate limit
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-light text-foreground">
                    {auditSummary.totalBillingErrors}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Erros ao acessar faturas
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
