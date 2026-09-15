/**
 * Admin Settings — Provider branding and API configuration page.
 * Extracted from AdminDashboard for better organization.
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
import {
  Settings,
  Image,
  Wifi,
  Upload,
  Type,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";
const BRANDING_STORAGE_KEY = "mikweb_branding";
const CONFIG_STORAGE_KEY = "mikweb_api_config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  } catch {}
}

function getStoredConfig(): { apiUrl: string; apiToken: string } | null {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeConfigData(apiUrl: string, apiToken: string) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ apiUrl, apiToken }));
  } catch {}
}

function withAdminToken(url: string): string {
  const token = getAdminToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(withAdminToken(apiUrl(url)), { ...init, credentials: "include" });
}

/** Test API connection from browser (for CORS-enabled APIs) */
async function testApiFromBrowser(
  baseUrl: string,
  token: string
): Promise<{ success: boolean; message: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      return { success: true, message: `Conexão OK! Status ${res.status}.` };
    }
    return { success: false, message: `Erro HTTP ${res.status}: ${res.statusText}` };
  } catch {
    return null; // CORS blocked — fallback to server-side test
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminSettings() {
  // ── Branding state ──
  const stored = getStoredBranding();
  const [providerName, setProviderName] = useState(stored?.providerName || "");
  const [logoUrl, setLogoUrl] = useState(stored?.logoUrl || "");
  const [logoInput, setLogoInput] = useState(stored?.logoUrl || "");
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);

  // ── API Config state ──
  const storedConfig = getStoredConfig();
  const [apiUrlState, setApiUrl] = useState(storedConfig?.apiUrl || "https://api.mikweb.com.br/v1/admin/");
  const [apiToken, setApiToken] = useState(storedConfig?.apiToken || "");
  const [showToken, setShowToken] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // ── Test connection state ──
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // ── Branding handlers ──
  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingError(null);
    setBrandingSaved(false);

    storeBranding(providerName, logoInput);
    setLogoUrl(logoInput);
    setBrandingSaved(true);

    try {
      const res = await adminFetch("/api/admin/branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, logoUrl: logoInput }),
      });
      if (!res.ok) {
        toast.warning("Marca salva localmente. Servidor indisponível.");
      } else {
        toast.success("Marca do provedor atualizada!");
      }
    } catch {
      toast.warning("Marca salva localmente. Servidor indisponível.");
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
      setLogoInput(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoInput("");
    setLogoUrl("");
  };

  // ── Config handlers ──
  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigSaved(false);

    storeConfigData(apiUrlState, apiToken);
    setConfigSaved(true);

    try {
      const res = await adminFetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl: apiUrlState, apiToken }),
      });
      if (!res.ok) {
        toast.warning("Configuração salva localmente. Servidor indisponível.");
      } else {
        toast.success("Configuração da API salva!");
      }
    } catch {
      toast.warning("Configuração salva localmente. Servidor indisponível.");
    } finally {
      setConfigSaving(false);
      setTimeout(() => setConfigSaved(false), 3000);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);

    try {
      if (!apiUrlState) {
        setConnectionResult({
          success: true,
          message: "Token salvo. A URL será usada das variáveis de ambiente.",
        });
        return;
      }

      const baseUrl = apiUrlState.replace(/\/$/, "");

      // 1. Try from browser first (works when CORS allows)
      const browserResult = await testApiFromBrowser(baseUrl, apiToken);
      if (browserResult) {
        setConnectionResult(browserResult);
        return;
      }

      // 2. Fallback: try via Supabase Edge Function (server-side)
      try {
        const res = await adminFetch("/api/admin/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiUrl: apiUrlState, apiToken }),
        });
        const data = await res.json();
        setConnectionResult(data);
        return;
      } catch {}

      setConnectionResult({
        success: false,
        message: `Não foi possível conectar em "${baseUrl}". Verifique a URL e o token.`,
      });
    } catch {
      setConnectionResult({
        success: false,
        message: "Erro ao testar conexão.",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Configurações
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personalize a marca do provedor e configure a integração com a API.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Branding Section ── */}
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
                    className="h-10 w-10 rounded-full object-cover"
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

        {/* ── API Config Section ── */}
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
                URL da API <span className="text-muted-foreground/50">(opcional)</span>
              </Label>
              <Input
                id="api-url"
                type="url"
                placeholder="https://api.mikweb.com.br/v1/admin/"
                value={apiUrlState}
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
                disabled={testingConnection || !apiToken}
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
                disabled={configSaving || !apiToken}
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
    </div>
  );
}
