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
import {  Settings,
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
  Bell,
  Send,
  MessageCircle,
  QrCode,
  Copy,
  MousePointerClick,
  PlugZap,
  FlaskConical,
  RefreshCw,
  Filter,
  BarChart3,
  MailCheck,
  MailOpen,

} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminSyncDialog } from "@/components/AdminSyncDialog";
import { AdminDispatchDialog } from "@/components/AdminDispatchDialog";
import { ReminderRulesCard } from "@/components/ReminderRulesCard";
import { ReminderMessagesCard } from "@/components/ReminderMessagesCard";
import { ChevronDown } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNavigate } from "react-router";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-config";
import type { FunnelTotalsView, FunnelWeekView } from "@/lib/engagement-types";

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

/** Resposta de `GET /api/admin/whatsapp/config` — só os campos que a tela usa. */
interface WhatsAppConfigView {
  baseUrl: string;
  instanceName: string | null;
  enabled: boolean;
  origin: "env" | "db" | "none";
  hasInstanceToken: boolean;
  hasAdminToken: boolean;
  instanceTokenMasked: string;
  adminTokenMasked: string;
  dailyNewChatCap: number;
  perCustomerCap: number;
  sendGapSeconds: number;
  windowStart: number;
  windowEnd: number;
  pausedUntil: number | null;
  lastStatus: string | null;
  lastStatusAt: number | null;
  instance: { state: string; connected: boolean } | null;
  limits: {
    newChatStatus: string | null;
    newChatUsed: number | null;
    newChatTotal: number | null;
    timeLockUntil: number | null;
  } | null;
  instanceError: string | null;
  stats: Record<string, number>;
  /** URL do webhook (com secret) montada pelo servidor, pronta para colar na UazAPI. */
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  cronSecretConfigured: boolean;
}

export default function AdminSettings() {
  const navigate = useNavigate();

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

  // ── Push notifications state ──
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushCpf, setPushCpf] = useState("");
  const [pushSending, setPushSending] = useState(false);

  // ── WhatsApp (UazAPI) state ──
  const [waConfig, setWaConfig] = useState<WhatsAppConfigView | null>(null);
  const [waLoading, setWaLoading] = useState(true);
  const [waError, setWaError] = useState<string | null>(null);
  const [waWebhookUrl, setWaWebhookUrl] = useState<string | null>(null);
  const [waCopied, setWaCopied] = useState(false);
  const [waBaseUrl, setWaBaseUrl] = useState("");
  const [waInstanceToken, setWaInstanceToken] = useState("");
  const [waAdminToken, setWaAdminToken] = useState("");
  const [waShowToken, setWaShowToken] = useState(false);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waCaps, setWaCaps] = useState({
    dailyNewChatCap: 200,
    perCustomerCap: 1,
    sendGapSeconds: 10,
    windowStart: 9,
    windowEnd: 20,
  });
  /** Ajustes avançados recolhidos por padrão: o ritmo resolve a maioria dos casos. */
  const [waShowAdvanced, setWaShowAdvanced] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waConnecting, setWaConnecting] = useState(false);
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waTestNumber, setWaTestNumber] = useState("");
  const [waTestEventKey, setWaTestEventKey] = useState("test");
  const [waTestOffset, setWaTestOffset] = useState(0);
  const [waTestDialog, setWaTestDialog] = useState(false);
  /** Régua em vigor — alimenta o seletor "Qual mensagem testar". */
  const [waRules, setWaRules] = useState<Array<{ key: string; eventKey: string; active: boolean; offsetDays: number }>>([]);
  const [waSyncOpen, setWaSyncOpen] = useState(false);
  const [waDispatchOpen, setWaDispatchOpen] = useState(false);

  const [waChecking, setWaChecking] = useState(false);
  const [waImportOpen, setWaImportOpen] = useState(false);
  const [waImportPlan, setWaImportPlan] = useState<{
    scanned: number;
    eligible: number;
    noPhone: number;
    phoneFailures: Record<string, number>;
    newContacts: number;
    updates: number;
    keptOptOut: number;
  } | null>(null);
  const [waImporting, setWaImporting] = useState(false);
  /** Uso real dos botões (cliques reportados pelo webhook, 30 dias). */
  const [waButtonStats, setWaButtonStats] = useState<Array<{ label: string; clicks: number; uniquePhones: number; matched: number; lastClickAt: number | null }> | null>(null);
  /** Funil de engajamento semanal (enviado → entregue → lido → Pix). */
  const [waFunnel, setWaFunnel] = useState<{ weeks: FunnelWeekView[]; totals: FunnelTotalsView; pending?: string } | null>(null);

  // ── WhatsApp handlers ──
  /** Aplica a resposta da API no estado da tela (usado pelo efeito e pelos handlers). */
  const applyWhatsAppConfig = useCallback((data: WhatsAppConfigView) => {
    setWaConfig(data);
    setWaBaseUrl(data.baseUrl || "");
    setWaEnabled(Boolean(data.enabled));
    setWaCaps({
      dailyNewChatCap: Number(data.dailyNewChatCap ?? 200),
      perCustomerCap: Number(data.perCustomerCap ?? 1),
      sendGapSeconds: Number(data.sendGapSeconds ?? 0),
      windowStart: Number(data.windowStart ?? 9),
      windowEnd: Number(data.windowEnd ?? 20),
    });
    setWaError(data.instanceError || null);
    setWaWebhookUrl(data.webhookUrl ?? null);
  }, []);

  const loadWhatsAppConfig = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/whatsapp/config");
      if (!res.ok) {
        setWaError("Não foi possível carregar a configuração do WhatsApp.");
        return;
      }
      applyWhatsAppConfig(await res.json());
    } catch {
      setWaError("Erro ao carregar a configuração do WhatsApp.");
    } finally {
      setWaLoading(false);
    }
  }, [applyWhatsAppConfig]);

  /** Régua em vigor para o seletor do teste (fallback: eventos padrão). */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/notifications/settings");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.rules)) return;
        if (!cancelled) {
          setWaRules(
            data.rules.filter((rule: { active?: boolean }) => rule.active !== false)
          );
        }
      } catch {
        // seletor cai no fallback de eventos padrão
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // IIFE assíncrona de propósito: os setState só acontecem DEPOIS do fetch, então
    // o efeito não dispara render em cascata (react-hooks/set-state-in-effect).
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/whatsapp/config");
        if (cancelled) return;
        if (!res.ok) {
          setWaError("Não foi possível carregar a configuração do WhatsApp.");
          return;
        }
        applyWhatsAppConfig(await res.json());
      } catch {
        if (!cancelled) setWaError("Erro ao carregar a configuração do WhatsApp.");
      } finally {
        if (!cancelled) setWaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyWhatsAppConfig]);

  useEffect(() => {
    // Métricas de cliques nos botões (migration 007). Falha silenciosa: se a view
    // ainda não existe, o endpoint devolve vazio e a seção simplesmente não aparece.
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/whatsapp/button-stats");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data?.stats)) setWaButtonStats(data.stats);
      } catch {
        // seção fica oculta
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Funil de engajamento por semana (enviado → entregue → lido → Pix). Se as
    // migrations ainda não estão aplicadas, o endpoint devolve semanas zeradas
    // com `pending` — a seção aparece com zeros e uma nota discreta.
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/whatsapp/engagement-funnel?weeks=8");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data?.weeks)) {
          setWaFunnel({ weeks: data.weeks, totals: data.totals, pending: data.pending });
        }
      } catch {
        // seção fica oculta
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveWhatsApp = async () => {
    setWaSaving(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: waBaseUrl,
          // Token vazio não apaga o que já está salvo (o backend ignora string vazia).
          instanceToken: waInstanceToken || undefined,
          adminToken: waAdminToken || undefined,
          enabled: waEnabled,
          ...waCaps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao salvar a configuração do WhatsApp.");
        return;
      }
      toast.success("Configuração do WhatsApp salva!");
      setWaInstanceToken("");
      setWaAdminToken("");
      await loadWhatsAppConfig();
    } catch {
      toast.error("Erro ao salvar a configuração do WhatsApp.");
    } finally {
      setWaSaving(false);
    }
  };

  const handleCheckWhatsApp = async () => {
    setWaChecking(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Não foi possível verificar o canal.");
        return;
      }
      if (data.ready) toast.success("Canal pronto para envio.");
      else toast.warning(data.reason || "Canal indisponível.");
      await loadWhatsAppConfig();
    } catch {
      toast.error("Não foi possível verificar o canal.");
    } finally {
      setWaChecking(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setWaConnecting(true);
    setWaQr(null);
    try {
      const res = await adminFetch("/api/admin/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao iniciar a conexão.");
        return;
      }
      if (data.qrCode) {
        setWaQr(String(data.qrCode));
        toast.info("Escaneie o QR Code no WhatsApp para conectar.");
      } else if (data.pairCode) {
        toast.info(`Código de pareamento: ${data.pairCode}`);
      } else {
        toast.warning("A instância não retornou QR Code nem código de pareamento.");
      }
    } catch {
      toast.error("Erro ao iniciar a conexão.");
    } finally {
      setWaConnecting(false);
    }
  };

  /** Prévia da importação (dry-run: planeja, não grava). */
  const previewImport = async () => {
    setWaImporting(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/import-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao planejar a importação.");
      setWaImportPlan(data.plan ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao planejar a importação.");
    } finally {
      setWaImporting(false);
    }
  };

  /** Executa a importação de fato. */
  const runImport = async () => {
    setWaImporting(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/import-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao importar os contatos.");
      toast.success(
        `Importação concluída: ${data.plan?.newContacts ?? 0} novos, ${data.plan?.updates ?? 0} atualizados.`
      );
      setWaImportOpen(false);
      setWaImportPlan(null);
      await loadWhatsAppConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar os contatos.");
    } finally {
      setWaImporting(false);
    }
  };

  const handleSendWhatsAppTest = async () => {
    try {
      const res = await adminFetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: waTestNumber,
          confirm: true,
          eventKey: waTestEventKey,
          ...(waTestEventKey !== "test" ? { offsetDays: waTestOffset } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao enviar o teste.");
      } else if (data.success) {
        toast.success(data.reason || "Mensagem de teste enviada.");
      } else {
        toast.error(data.reason || "A mensagem de teste não foi enviada.");
      }
      setWaTestDialog(false);
      await loadWhatsAppConfig();
    } catch {
      toast.error("Falha ao enviar o teste.");
    }
  };

  /** Copia a URL do webhook (com secret) para a área de transferência. */
  const handleCopyWebhookUrl = async () => {
    if (!waWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(waWebhookUrl);
      setWaCopied(true);
      toast.success("URL do webhook copiada!");
      setTimeout(() => setWaCopied(false), 2500);
    } catch {
      // Clipboard API pode estar bloqueada (permissão/HTTP): seleciona o texto
      // para o admin copiar com Ctrl+C sem caçar o campo na tela.
      (document.getElementById("wa-webhook") as HTMLInputElement | null)?.select();
      toast.info("Selecione o texto e copie manualmente (Ctrl+C).");
    }
  };

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

  // ── Push notification handler ──
  const handleSendPush = async () => {
    if (!pushTitle.trim() || !pushBody.trim()) {
      toast.error("Preencha título e mensagem.");
      return;
    }
    setPushSending(true);
    try {
      const res = await adminFetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pushTitle,
          body: pushBody,
          cpf: pushCpf.trim() ? pushCpf : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        toast.error(data.error || "Erro ao enviar notificação.");
        return;
      }
      if (data.total != null) {
        toast.success("Notificação enviada", {
          description: `${data.sent}/${data.total} dispositivos notificados.`,
        });
      } else {
        toast.success("Notificação enviada", {
          description: `${data.sent} dispositivo(s) notificado(s).`,
        });
      }
      setPushTitle("");
      setPushBody("");
      setPushCpf("");
    } catch {
      toast.error("Erro ao enviar notificação.");
    } finally {
      setPushSending(false);
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

      {/* ── Push Notifications ── */}
      <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.1s_both]">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              Notificações Push
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Envie para todos os inscritos ou para um CPF específico.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Título
            </Label>
            <Input
              placeholder="Ex: Nova fatura disponível"
              value={pushTitle}
              onChange={(e) => setPushTitle(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Mensagem
            </Label>
            <Input
              placeholder="Ex: Sua fatura de julho já está disponível."
              value={pushBody}
              onChange={(e) => setPushBody(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              CPF <span className="text-muted-foreground/50">(opcional)</span>
            </Label>
            <Input
              placeholder="Vazio = todos os clientes inscritos"
              value={pushCpf}
              onChange={(e) => setPushCpf(e.target.value)}
              className="h-9 text-xs font-mono"
            />
          </div>
          <Button
            variant="default"
            size="sm"
            className="w-full text-xs h-9"
            onClick={handleSendPush}
            disabled={pushSending || !pushTitle.trim() || !pushBody.trim()}
          >
            {pushSending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            {pushSending ? "Enviando..." : "Enviar notificação"}
          </Button>
        </CardContent>
      </Card>

      {/* ── WhatsApp (UazAPI) ── */}
      <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.15s_both]">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">
                Lembretes por WhatsApp
              </CardTitle>
            </div>
            {waLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-sm border ${
                  waConfig?.instance?.connected
                    ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/30 text-amber-600 dark:text-amber-400"
                }`}
              >
                {waConfig?.instance?.connected
                  ? "conectada"
                  : waConfig?.instance?.state || "sem status"}
              </span>
            )}
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Integração via UazAPI. Os secrets <code className="font-mono">UAZAPI_BASE_URL</code> e{" "}
            <code className="font-mono">UAZAPI_INSTANCE_TOKEN</code> têm prioridade sobre o que for
            salvo aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Estado atual — o que o backend realmente enxerga */}
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded-sm border border-border">
              credenciais: {waConfig?.origin === "env" ? "secrets do servidor" : waConfig?.origin === "db" ? "salvas no painel" : waConfig?.origin ?? "—"}
            </span>
            <span className="px-2 py-0.5 rounded-sm border border-border">
              token: {waConfig?.hasInstanceToken ? waConfig?.instanceTokenMasked : "não configurado"}
            </span>
            {waConfig?.limits ? (
              <span
                className="px-2 py-0.5 rounded-sm border border-border"
                title="Limite de novas conversas imposto pela UazAPI (provedor WhatsApp) — não é configuração do painel"
              >
                capping UazAPI: {waConfig.limits.newChatUsed ?? "?"}/
                {waConfig.limits.newChatTotal ?? "?"} conversas novas
                {waConfig.limits.newChatStatus ? ` · ${waConfig.limits.newChatStatus}` : ""}
              </span>
            ) : null}
            {waConfig?.pausedUntil ? (
              <span className="px-2 py-0.5 rounded-sm border border-amber-500/30 text-amber-600 dark:text-amber-400">
                pausado até {new Date(Number(waConfig.pausedUntil)).toLocaleDateString("pt-BR")}
              </span>
            ) : null}
            {waConfig?.stats?.["whatsapp:sent"] ? (
              <span className="px-2 py-0.5 rounded-sm border border-border">
                enviados (7d): {waConfig.stats["whatsapp:sent"]}
              </span>
            ) : null}
          </div>

          {waError ? (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{waError}</span>
            </div>
          ) : null}

          {/* Uso real dos botões de ação (webhook, últimos 30 dias) */}
          {waButtonStats && waButtonStats.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <MousePointerClick className="h-3.5 w-3.5 text-emerald-600" />
                Cliques nos botões (30 dias)
              </div>
              <div className="grid gap-1.5">
                {waButtonStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between gap-2 rounded-sm border border-border px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-medium text-foreground truncate" title={stat.label}>
                      {stat.label}
                    </span>
                    <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      <span className="font-mono text-foreground">{stat.clicks}</span>
                      <span>cliques</span>
                      <span className="text-border">·</span>
                      <span className="font-mono">{stat.uniquePhones}</span>
                      <span>clientes</span>
                      {stat.lastClickAt ? (
                        <span
                          className="text-[10px]"
                          title={new Date(stat.lastClickAt).toLocaleString("pt-BR")}
                        >
                          últ. {new Date(stat.lastClickAt).toLocaleDateString("pt-BR")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Funil de engajamento por semana — enviado → entregue → lido → Pix */}
          {waFunnel ? (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Filter className="h-3.5 w-3.5 text-emerald-600" />
                  Funil de engajamento (por semana)
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> enviados</span>
                  <span className="flex items-center gap-1"><MailCheck className="h-3 w-3" /> entregues</span>
                  <span className="flex items-center gap-1"><MailOpen className="h-3 w-3" /> lidos</span>
                  <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> Pix</span>
                </div>
              </div>
              <div className="grid gap-1.5">
                {waFunnel.weeks.map((week) => {
                  const max = Math.max(week.sent, 1);
                  return (
                    <div key={week.weekStart} className="rounded-sm border border-border px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-foreground">{week.label}</span>
                        {week.failed > 0 ? (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400" title="Falhas reportadas pelo WhatsApp na semana">
                            {week.failed} falha{week.failed > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {([
                          ["sent", week.sent, "bg-sky-500/70"],
                          ["delivered", week.delivered, "bg-emerald-500/70"],
                          ["read", week.read, "bg-violet-500/70"],
                          ["pixClicks", week.pixClicks, "bg-amber-500/70"],
                        ] as const).map(([key, value, barClass]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-muted">
                              <div className={`h-full rounded-sm ${barClass}`} style={{ width: `${(value / max) * 100}%` }} />
                            </div>
                            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span>
                  total (8 sem.):{" "}
                  <span className="font-mono text-foreground">{waFunnel.totals.sent}</span> enviados ·{" "}
                  <span className="font-mono text-foreground">{waFunnel.totals.delivered}</span> entregues ·{" "}
                  <span className="font-mono text-foreground">{waFunnel.totals.read}</span> lidos ·{" "}
                  <span className="font-mono text-foreground">{waFunnel.totals.pixClicks}</span> clicaram no Pix
                </span>
                {waFunnel.pending ? <span className="text-amber-600 dark:text-amber-400">({waFunnel.pending})</span> : null}
              </div>
            </div>
          ) : null}

          {/* URL do webhook — montada no servidor com o secret, pronta para colar na UazAPI */}
          {waWebhookUrl ? (
            <div className="space-y-2">
              <Label htmlFor="wa-webhook" className="text-xs font-medium text-muted-foreground">
                URL do webhook{" "}
                <span className="text-muted-foreground/50">(colar na UazAPI → Webhook)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="wa-webhook"
                  readOnly
                  value={waWebhookUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 text-[11px] font-mono text-muted-foreground"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-9 shrink-0 cursor-pointer"
                  onClick={handleCopyWebhookUrl}
                >
                  {waCopied ? (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {waCopied ? "Copiada!" : "Copiar"}
                </Button>
              </div>
              {!waConfig?.webhookSecretConfigured ? (
                <p className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    Sem o secret <code className="font-mono">UAZAPI_WEBHOOK_SECRET</code> configurado,
                    esta URL aceita chamadas de qualquer origem. Configure o secret para proteger o
                    webhook.
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="wa-url" className="text-xs font-medium text-muted-foreground">
              Server URL da UazAPI
            </Label>
            <Input
              id="wa-url"
              type="url"
              placeholder="https://sua-instancia.uazapi.com"
              value={waBaseUrl}
              onChange={(e) => setWaBaseUrl(e.target.value)}
              className="h-9 text-xs font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wa-token" className="text-xs font-medium text-muted-foreground">
                Token da instância
              </Label>
              <div className="relative">
                <Input
                  id="wa-token"
                  type={waShowToken ? "text" : "password"}
                  placeholder={waConfig?.hasInstanceToken ? "••••••••  (manter atual)" : "token da instância"}
                  value={waInstanceToken}
                  onChange={(e) => setWaInstanceToken(e.target.value)}
                  className="h-9 text-xs font-mono pr-9"
                />
                <button
                  type="button"
                  onClick={() => setWaShowToken(!waShowToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {waShowToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wa-admin" className="text-xs font-medium text-muted-foreground">
                admintoken <span className="text-muted-foreground/50">(opcional)</span>
              </Label>
              <Input
                id="wa-admin"
                type="password"
                placeholder={waConfig?.hasAdminToken ? "••••••••  (manter atual)" : "só para criar/listar instância"}
                value={waAdminToken}
                onChange={(e) => setWaAdminToken(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-sm border border-border">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Canal ativo</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Desligado, nenhuma mensagem sai — nem pelo botão de envio manual.
              </p>
            </div>
            <Switch checked={waEnabled} onCheckedChange={setWaEnabled} className="cursor-pointer" />
          </div>

          {/* Ritmo — o que o usuário realmente quer controlar: o intervalo entre
              uma mensagem e a outra. A cota anti-bloqueio fica escondida nos
              avançados: é guarda de segurança, não controle de alcance. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Pausa entre uma mensagem e outra
              </Label>
              <span className="text-[10px] text-muted-foreground font-mono">
                {waCaps.sendGapSeconds > 0
                  ? `${waCaps.sendGapSeconds}–${waCaps.sendGapSeconds * 2}s`
                  : "automática (2,5–9s)"}
              </span>
            </div>
            <ToggleGroup
              type="single"
              spacing={2}
              variant="outline"
              value={String(waCaps.sendGapSeconds)}
              onValueChange={(value) => {
                if (!value) return;
                setWaCaps({ ...waCaps, sendGapSeconds: Number(value) });
              }}
              className="flex-wrap"
            >
              <ToggleGroupItem value="10" className="text-xs cursor-pointer">10s</ToggleGroupItem>
              <ToggleGroupItem value="30" className="text-xs cursor-pointer">30s</ToggleGroupItem>
              <ToggleGroupItem value="60" className="text-xs cursor-pointer">1 min</ToggleGroupItem>
              <ToggleGroupItem value="120" className="text-xs cursor-pointer">2 min</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {waCaps.sendGapSeconds > 0
                ? `Envia 1 mensagem a cada ${waCaps.sendGapSeconds}–${waCaps.sendGapSeconds * 2} segundos, dentro da janela de envio — TODOS os devedores do dia recebem, só que em ritmo seguro.`
                : "Sem pausa configurada, o sistema usa um ritmo automático de 2,5–9 segundos entre mensagens."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setWaShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${waShowAdvanced ? "" : "-rotate-90"}`} />
            Ajustes avançados
          </button>
          {waShowAdvanced && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Pausa customizada (s)
              </Label>
              <Input
                type="number"
                min={0}
                max={3600}
                value={waCaps.sendGapSeconds}
                onChange={(e) => setWaCaps({ ...waCaps, sendGapSeconds: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Avisos por cliente/dia
              </Label>
              <Input
                type="number"
                min={1}
                value={waCaps.perCustomerCap}
                onChange={(e) => setWaCaps({ ...waCaps, perCustomerCap: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Janela — início (h)
              </Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={waCaps.windowStart}
                onChange={(e) => setWaCaps({ ...waCaps, windowStart: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Janela — fim (h)
              </Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={waCaps.windowEnd}
                onChange={(e) => setWaCaps({ ...waCaps, windowEnd: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-2 col-span-2 sm:col-span-4">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Teto diário de novas conversas (proteção do número)
              </Label>
              <Input
                type="number"
                min={0}
                value={waCaps.dailyNewChatCap}
                onChange={(e) => setWaCaps({ ...waCaps, dailyNewChatCap: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Guarda de segurança contra bloqueio do WhatsApp (time-lock). 0 = sem teto.
                Só reduza se o WhatsApp avisar sobre o número.
              </p>
            </div>
          </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={handleSaveWhatsApp}
              disabled={waSaving}
            >
              {waSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Salvar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={handleCheckWhatsApp}
              disabled={waChecking}
            >
              {waChecking ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5 mr-1.5" />
              )}
              Testar canal
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={handleConnectWhatsApp}
              disabled={waConnecting}
            >
              {waConnecting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <QrCode className="h-3.5 w-3.5 mr-1.5" />
              )}
              Conectar (QR)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={() => setWaImportOpen(true)}
            >
              <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
              Importar contatos
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setWaSyncOpen(true)}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Sincronizar cobranças
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setWaDispatchOpen(true)}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Disparar fila outbox
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-9 cursor-pointer text-muted-foreground"
              onClick={() => navigate("/admin/simulator")}
            >
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
              Ver o que sairia
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Antes de ligar o canal ativo, rode o simulador: ele mostra quantos avisos sairiam,
            quantos ficam presos na cota de novas conversas e quantos clientes ficam sem canal.
          </p>

          {waQr ? (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Abra o WhatsApp → Aparelhos conectados → Conectar aparelho.
              </p>
              <img
                src={waQr.startsWith("data:") ? waQr : `data:image/png;base64,${waQr}`}
                alt="QR Code da instância UazAPI"
                className="h-40 w-40 rounded-sm border border-border bg-white p-2"
              />
            </div>
          ) : null}

          <div className="space-y-2 pt-1">
            <Label htmlFor="wa-test" className="text-xs font-medium text-muted-foreground">
              Teste de envio
            </Label>
            <div className="flex gap-2">
              <Input
                id="wa-test"
                placeholder="DDD + celular (ex: 11 98765-4321)"
                value={waTestNumber}
                onChange={(e) => setWaTestNumber(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-9 shrink-0 cursor-pointer"
                onClick={() => setWaTestDialog(true)}
                disabled={waTestNumber.replace(/\D/g, "").length < 10}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Enviar teste
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Qual mensagem testar
              </Label>
              <Select
                value={waTestEventKey}
                onValueChange={(value) => {
                  setWaTestEventKey(value);
                  // Auto-preenche o deslocamento com o da regra da régua (a mais
                  // representativa, em ordem de prioridade).
                  if (value !== "test") {
                    const rule = [...(waRules ?? [])]
                      .filter((r) => r.eventKey === value)
                      .sort((a, b) => a.offsetDays - b.offsetDays)[0];
                    if (rule) setWaTestOffset(Math.abs(rule.offsetDays) || 1);
                  }
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="test" className="text-xs">
                    Sonda do canal (mensagem de teste)
                  </SelectItem>
                  {(waRules?.length
                    ? waRules.map((r) => ({ eventKey: r.eventKey, label: r.key }))
                    : [
                        { eventKey: "billing.due_soon", label: "fatura a vencer" },
                        { eventKey: "billing.due_today", label: "vence hoje" },
                        { eventKey: "billing.late", label: "em atraso" },
                      ]
                  ).map(({ eventKey, label }) => (
                    <SelectItem key={eventKey} value={eventKey} className="text-xs">
                      Régua: {label} ({eventKey})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {waTestEventKey !== "test" ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={waTestOffset}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setWaTestOffset(Number.isFinite(value) ? value : 0);
                    }}
                    className="h-8 w-20 text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    dias de deslocamento (a mensagem mostra {waTestOffset} dia(s) de atraso)
                  </span>
                </div>
              ) : null}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              O teste passa pela outbox e pelo mesmo adapter do lembrete — se ele chega, o
              caminho de envio está inteiro. Escolhendo uma opção da régua, você recebe a
              mensagem no formato exato que o cliente receberia.
            </p>
          </div>

          {/* Operação da fila — o que define produção fica aqui, não no simulador */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setWaSyncOpen(true)}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Sincronizar agora (prévia → enfileirar)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setWaDispatchOpen(true)}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Disparar fila outbox
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={waImportOpen}
        onOpenChange={(open) => {
          setWaImportOpen(open);
          if (!open) setWaImportPlan(null);
        }}
        title="Importar contatos da MikWeb?"
        description="Cria contatos de WhatsApp a partir dos celulares da base. Quem pediu PARA sair não é reativado."
        confirmLabel={waImportPlan ? `Importar ${waImportPlan.newContacts} novos` : "Planejar importação"}
        onConfirm={waImportPlan ? runImport : previewImport}
      >
        <div className="space-y-3">
          {waImportPlan ? (
            <div className="space-y-1 text-xs">
              <p>
                Clientes varridos: <span className="font-mono">{waImportPlan.scanned}</span> · elegíveis: <span className="font-mono">{waImportPlan.eligible}</span>
              </p>
              <p>
                Novos contatos: <span className="font-medium text-emerald-600 dark:text-emerald-400">{waImportPlan.newContacts}</span> · atualizações: <span className="font-mono">{waImportPlan.updates}</span>
              </p>
              <p className="text-muted-foreground">
                Sem celular: {waImportPlan.noPhone} · fixo/inválido: {Object.values(waImportPlan.phoneFailures).reduce((a, b) => a + b, 0)} · opt-out preservado: {waImportPlan.keptOptOut}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Novos contatos entram com opt-in = autorização de receber pelo portal. Se não for
                o caso, desative o canal antes de importar.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A prévia varre a base da MikWeb e mostra o que seria importado, sem gravar nada.
              Clique de novo para executar.
            </p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={waTestDialog}
        onOpenChange={setWaTestDialog}
        title="Enviar mensagem de teste?"
        description="A mensagem será enviada de verdade para o número informado."
        confirmLabel="Enviar teste"
        onConfirm={handleSendWhatsAppTest}
      >
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Destino: <span className="text-foreground font-mono">{waTestNumber}</span>
          </p>
          <p className="text-muted-foreground">
            Uma mensagem de teste será enviada e aparecerá no histórico de notificações.
          </p>
        </div>
      </ConfirmDialog>

      {/* Régua e Mensagens: configuração de produção do pipeline de lembretes */}
      <ReminderRulesCard />
      <ReminderMessagesCard />

      <AdminSyncDialog
        open={waSyncOpen}
        onOpenChange={setWaSyncOpen}
        onSyncCompleted={() => {
          void loadWhatsAppConfig();
        }}
        onOpenDispatch={() => {
          setWaDispatchOpen(true);
        }}
      />

      <AdminDispatchDialog
        open={waDispatchOpen}
        onOpenChange={setWaDispatchOpen}
        onDispatchCompleted={() => {
          void loadWhatsAppConfig();
        }}
      />
    </div>
  );
}
