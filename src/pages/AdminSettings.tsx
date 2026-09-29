/**
 * Admin Settings — Provider branding and push notifications.
 *
 * Página enxuta após a reorganização do painel: as credenciais (MikWeb/UazAPI)
 * moram em "Conexões" (/admin/connections) e a régua de lembretes em "Régua"
 * (/admin/rules). Aqui fica o que é aparência e avistamento pontual: marca do
 * provedor e envio de notificação push manual.
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
  Image,
  Wifi,
  Upload,
  Type,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Bell,
  Send,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";
const BRANDING_STORAGE_KEY = "mikweb_branding";

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
  } catch {
    // localStorage indisponível (modo privado/permissão): a marca só não persiste localmente.
  }
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminSettings() {
  // ── Branding state ──
  const stored = getStoredBranding();
  const [providerName, setProviderName] = useState(stored?.providerName || "");
  const [logoInput, setLogoInput] = useState(stored?.logoUrl || "");
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);

  // ── Push notifications state ──
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushCpf, setPushCpf] = useState("");
  const [pushSending, setPushSending] = useState(false);

  // ── Branding handlers ──
  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingError(null);
    setBrandingSaved(false);

    storeBranding(providerName, logoInput);
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
          Marca do provedor e notificações push. Credenciais ficam em{" "}
          <strong className="font-medium text-foreground">Conexões</strong> e a régua de
          lembretes em <strong className="font-medium text-foreground">Régua</strong>.
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

        {/* ── Push Notifications ── */}
        <Card className="border-border shadow-none">
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
      </div>
    </div>
  );
}
