/**
 * AdminConnections — página "Conexões" do menu admin.
 *
 * TODAS as credenciais do provedor em um único lugar:
 * - MikWeb (ERP de faturas): URL da API + token, testar e salvar. O token salvo
 *   aqui é o que o servidor usa nas sincronizações e consultas reais.
 * - WhatsApp (UazAPI): o fluxo de envio como trilha guiada (SendFlowCard) no topo,
 *   seguido dos campos de conexão e operação da fila (antes na página Configurações).
 *
 * A página é de movimentação: os cards e handlers já em produção vieram de
 * AdminSettings, sem mudança de comportamento — inclusive o aviso de que secrets
 * do servidor (env) têm prioridade sobre o que for salvo aqui.
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdminSyncDialog } from "@/components/AdminSyncDialog";
import { AdminDispatchDialog } from "@/components/AdminDispatchDialog";
import { SendFlowCard } from "@/components/SendFlowCard";
import {
  Settings,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  MessageCircle,
  QrCode,
  Copy,
  RefreshCw,
  Send,
  ChevronDown,
  PlugZap,
  BellRing,
  Webhook,
  Plus,
  Trash2,
  Power,
  Building2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-config";
import type { FunnelTotalsView, FunnelWeekView } from "@/lib/engagement-types";

// ---------------------------------------------------------------------------
// Helpers (mesmos de AdminSettings: token de admin em localStorage)
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
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

/** Conexão MikWeb como o backend devolve (token NUNCA vem — só mascarado). */
interface MikWebConnectionView {
  id: string;
  slug: string;
  label: string;
  apiUrl: string;
  tokenMasked: string;
  hasToken: boolean;
  active: boolean;
  lastTestOk: boolean | null;
  lastTestAt: number | null;
  lastTestError: string | null;
}

export default function AdminConnections() {
  const navigate = useNavigate();

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

  // ── Multi-conta MikWeb (migration 010) ──
  const [connections, setConnections] = useState<MikWebConnectionView[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsMigrationPending, setConnectionsMigrationPending] = useState(false);
  const [connectionsEnvFallback, setConnectionsEnvFallback] = useState(false);
  /** Formulário inline: null = lista; "new" = criar; id = editar existente. */
  const [editingConnection, setEditingConnection] = useState<string | "new" | null>(null);
  const [connectionForm, setConnectionForm] = useState({ label: "", apiUrl: "", apiToken: "" });
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [testingSlug, setTestingSlug] = useState<string | null>(null);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // ── Alertas de operação (o sistema avisa o admin por WhatsApp) ──
  const [alertPhone, setAlertPhone] = useState("");
  const [alertChannelDown, setAlertChannelDown] = useState(true);
  const [alertDispatchFailures, setAlertDispatchFailures] = useState(true);
  const [alertStuckQueue, setAlertStuckQueue] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState(5);
  const [alertDailySummary, setAlertDailySummary] = useState(false);
  const [alertButtons, setAlertButtons] = useState<Array<{ label: string; url: string }>>([{ label: "Abrir painel", url: "" }]);
  const [alertLastSentAt, setAlertLastSentAt] = useState<Record<string, number>>({});
  const [alertLoading, setAlertLoading] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [webhookApplying, setWebhookApplying] = useState(false);

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

  const loadAlerts = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/alerts");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setAlertPhone(data.alerts?.phone || "");
      setAlertChannelDown(data.alerts?.alertChannelDown !== false);
      setAlertDispatchFailures(data.alerts?.alertDispatchFailures !== false);
      setAlertStuckQueue(data.alerts?.alertStuckQueue !== false);
      setAlertThreshold(Number(data.alerts?.failureThreshold ?? 5));
      setAlertDailySummary(data.alerts?.dailySummary === true);
      setAlertButtons(
        Array.isArray(data.alerts?.buttons) && data.alerts.buttons.length
          ? data.alerts.buttons.slice(0, 3)
          : [{ label: "Abrir painel", url: "" }]
      );
      setAlertLastSentAt(data.lastSentAt && typeof data.lastSentAt === "object" ? data.lastSentAt : {});
    } catch {
      // card segue com defaults; o botão salvar corrige
    } finally {
      setAlertLoading(false);
    }
  }, []);

  useEffect(() => {
    // IIFE assíncrona: os setState só acontecem DEPOIS do fetch (sem cascata).
    void (async () => {
      await loadAlerts();
    })();
  }, [loadAlerts]);

  const handleSaveAlerts = async () => {
    setAlertSaving(true);
    try {
      const res = await adminFetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: alertPhone,
          alertChannelDown,
          alertDispatchFailures,
          alertStuckQueue,
          failureThreshold: alertThreshold,
          dailySummary: alertDailySummary,
          buttons: alertButtons,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao salvar os alertas.");
        return;
      }
      toast.success("Alertas salvos!", { description: "O sistema avisará este número quando algo precisar de você." });
    } catch {
      toast.error("Erro ao salvar os alertas.");
    } finally {
      setAlertSaving(false);
    }
  };

  const handleTestAlert = async () => {
    setAlertTesting(true);
    try {
      const res = await adminFetch("/api/admin/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha no teste.");
        return;
      }
      if (data.via === "whatsapp") toast.success("Cheque seu WhatsApp — a mensagem de teste saiu!");
      else if (data.via === "push") toast.warning("WhatsApp indisponível — teste foi por push do painel.");
      else toast.error(data.reason || "Nenhum canal entregou o teste.");
    } catch {
      toast.error("Falha no teste de alerta.");
    } finally {
      setAlertTesting(false);
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

  /** Registra a URL do webhook na UazAPI sem sair do painel (POST /webhook deles). */
  const handleApplyWebhook = async () => {
    setWebhookApplying(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/webhook-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "A UazAPI recusou o registro do webhook.");
        return;
      }
      toast.success("Webhook registrado na UazAPI!", {
        description: "Eventos: mensagens, atualizações de status e conexão.",
      });
      if (data.warning) toast.warning(data.warning);
    } catch {
      toast.error("Erro ao aplicar o webhook.");
    } finally {
      setWebhookApplying(false);
    }
  };

  // ── Multi-conta MikWeb: carregamento e ações ──
  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const res = await adminFetch("/api/admin/connections");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConnections(Array.isArray(data.connections) ? data.connections : []);
        setConnectionsEnvFallback(data.envFallback === true);
        setConnectionsMigrationPending(data.migrationPending === true);
      }
    } catch {
      // card segue com a lista vazia; recarregar corrige
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    // IIFE assíncrona: os setState só acontecem DEPOIS do fetch (sem cascata).
    void (async () => {
      await loadConnections();
    })();
  }, [loadConnections]);

  const openNewConnection = () => {
    setConnectionForm({ label: "", apiUrl: "https://api.mikweb.com.br/v1/admin/", apiToken: "" });
    setEditingConnection("new");
  };

  const openEditConnection = (connection: MikWebConnectionView) => {
    // Token NUNCA volta do servidor: o campo fica vazio e vazio = manter o atual.
    setConnectionForm({ label: connection.label, apiUrl: connection.apiUrl, apiToken: "" });
    setEditingConnection(connection.id);
  };

  const handleSaveConnection = async () => {
    setConnectionSaving(true);
    try {
      const isEdit = editingConnection !== "new" && editingConnection !== null;
      const res = await adminFetch(isEdit ? `/api/admin/connections/${editingConnection}/update` : "/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: connectionForm.label,
          apiUrl: connectionForm.apiUrl,
          // Na edição, token vazio = manter o atual (o backend ignora vazio).
          apiToken: connectionForm.apiToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao salvar a conta.");
        return;
      }
      toast.success(isEdit ? "Conta atualizada!" : `Conta salva (identificador ${data.slug}).`);
      if (!isEdit && data.tested === false && data.testError) {
        toast.warning(`Salva, mas o teste falhou: ${data.testError}`);
      }
      setEditingConnection(null);
      await loadConnections();
    } catch {
      toast.error("Erro ao salvar a conta.");
    } finally {
      setConnectionSaving(false);
    }
  };

  const handleTestConnectionById = async (id: string) => {
    setTestingSlug(id);
    try {
      const res = await adminFetch(`/api/admin/connections/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha no teste.");
        return;
      }
      if (data.success) toast.success(data.message || "Conexão OK!");
      else toast.error(data.message || "A conta não respondeu.");
      await loadConnections();
    } catch {
      toast.error("Falha no teste de conexão.");
    } finally {
      setTestingSlug(null);
    }
  };

  const handleToggleConnection = async (id: string) => {
    setTogglingSlug(id);
    try {
      const res = await adminFetch(`/api/admin/connections/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao ativar/desativar.");
        return;
      }
      toast.success(data.active ? "Conta ativada." : "Conta desativada — sync e portal ignoram esta conta.");
      await loadConnections();
    } catch {
      toast.error("Erro ao ativar/desativar a conta.");
    } finally {
      setTogglingSlug(null);
    }
  };

  const handleDeleteConnection = async () => {
    if (!deletingId) return;
    try {
      const res = await adminFetch(`/api/admin/connections/${deletingId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao remover a conta.");
        return;
      }
      toast.success("Conta removida.");
      setRemoveDialogOpen(false);
      setDeletingId(null);
      await loadConnections();
    } catch {
      toast.error("Erro ao remover a conta.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Conexões
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Todas as credenciais do provedor em um só lugar: MikWeb (faturas) e WhatsApp
          (UazAPI).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── MikWeb (ERP) — MULTI-CONTA ── */}
        <Card className="border-border shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  Contas MikWeb (ERP de faturas)
                </CardTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 cursor-pointer shrink-0"
                onClick={openNewConnection}
                disabled={editingConnection === "new"}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Adicionar conta
              </Button>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Duas contas do ERP alimentam o mesmo canal: o sync varre todas as ativas e
              cada cliente/fatura guarda de qual conta veio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {connectionsLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando contas…
              </div>
            ) : connectionsMigrationPending ? (
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  A migration 010 ainda não foi aplicada — o sistema está usando a credencial
                  única antiga como "Conta A".
                </span>
              </div>
            ) : connections.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhuma conta cadastrada ainda. Adicione a primeira — ou confirme que os
                secrets MIKWEB_API_URL/MIKWEB_API_TOKEN estão configurados (elas atuam como a
                "Conta A").
              </p>
            ) : (
              <div className="space-y-2">
                {connections.map((connection) => (
                  <div
                    key={connection.id}
                    className={`rounded-sm border px-3 py-2.5 space-y-1.5 ${
                      connection.active ? "border-border" : "border-border/50 opacity-70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {connection.label}{" "}
                          <span className="text-[10px] font-mono text-muted-foreground">({connection.slug})</span>
                          {!connection.active ? (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">· inativa</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          {connection.apiUrl || "URL nos secrets"} · token {connection.hasToken ? connection.tokenMasked : "nos secrets"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {connection.lastTestOk === true ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : connection.lastTestOk === false ? (
                          <span title={connection.lastTestError ?? "Último teste falhou"} className="inline-flex">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          </span>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] cursor-pointer"
                          onClick={() => handleTestConnectionById(connection.id)}
                          disabled={testingSlug === connection.id}
                        >
                          {testingSlug === connection.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3 w-3 mr-1" />
                          )}
                          Testar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] cursor-pointer"
                          onClick={() => openEditConnection(connection)}
                        >
                          <Settings className="h-3 w-3 mr-1" />
                          Editar
                        </Button>
                        <button
                          type="button"
                          title={connection.active ? "Desativar conta" : "Ativar conta"}
                          onClick={() => handleToggleConnection(connection.id)}
                          disabled={togglingSlug === connection.id}
                          className="p-1.5 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                        >
                          {togglingSlug === connection.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Power className={`h-3.5 w-3.5 ${connection.active ? "text-emerald-600 dark:text-emerald-400" : ""}`} />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Remover conta"
                          onClick={() => {
                            setDeletingId(connection.id);
                            setRemoveDialogOpen(true);
                          }}
                          className="p-1.5 text-muted-foreground hover:text-destructive cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {connection.lastTestOk === false && connection.lastTestError ? (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate" title={connection.lastTestError}>
                        {connection.lastTestError}
                      </p>
                    ) : null}
                  </div>
                ))}
                {connectionsEnvFallback ? (
                  <p className="text-[10px] text-muted-foreground">
                    Os secrets MIKWEB_API_URL/MIKWEB_API_TOKEN servem como respaldo da conexão
                    "a" quando ela não tem token próprio.
                  </p>
                ) : null}
              </div>
            )}

            {/* Formulário inline (nova conta / edição) */}
            {editingConnection !== null ? (
              <div className="space-y-3 rounded-sm border border-border p-3 bg-secondary/20">
                <p className="text-xs font-medium text-foreground">
                  {editingConnection === "new" ? "Nova conta MikWeb" : "Editar conta"}
                </p>
                <div className="space-y-2">
                  <Label className="text-[10px] font-medium text-muted-foreground">Nome da conta</Label>
                  <Input
                    placeholder="Ex.: Conta B (filial)"
                    value={connectionForm.label}
                    onChange={(e) => setConnectionForm({ ...connectionForm, label: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-medium text-muted-foreground">URL da API</Label>
                  <Input
                    type="url"
                    placeholder="https://api.mikweb.com.br/v1/admin/"
                    value={connectionForm.apiUrl}
                    onChange={(e) => setConnectionForm({ ...connectionForm, apiUrl: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-medium text-muted-foreground">
                    Token {editingConnection !== "new" ? <span className="text-muted-foreground/50">(vazio = manter atual)</span> : ""}
                  </Label>
                  <Input
                    type="password"
                    placeholder="Bearer token"
                    value={connectionForm.apiToken}
                    onChange={(e) => setConnectionForm({ ...connectionForm, apiToken: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-9 cursor-pointer"
                    onClick={() => setEditingConnection(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 text-xs h-9 cursor-pointer"
                    onClick={handleSaveConnection}
                    disabled={
                      connectionSaving ||
                      !connectionForm.label.trim() ||
                      !connectionForm.apiUrl.trim() ||
                      (editingConnection === "new" && !connectionForm.apiToken.trim())
                    }
                  >
                    {connectionSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                    Salvar
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Desativar NÃO apaga nada: a conta só sai do sync, das consultas e do portal.
              A última conta ativa não pode ser desativada nem removida.
            </p>
          </CardContent>
        </Card>

        {/* ── Estado WhatsApp (resumo ao lado das credenciais) ── */}
        <Card className="border-border shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  WhatsApp — estado atual
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
            {/* O fluxo como trilha guiada — a porta de entrada da seção */}
            <SendFlowCard />

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
                    Funil de engajamento (por semana)
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>enviados</span>
                    <span>· entregues</span>
                    <span>· lidos</span>
                    <span>· Pix</span>
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
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 cursor-pointer"
                    onClick={handleApplyWebhook}
                    disabled={webhookApplying || !waBaseUrl}
                  >
                    {webhookApplying ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Webhook className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Aplicar webhook automaticamente
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Registra a URL acima na UazAPI (mensagens, status e conexão) — sem entrar no painel deles.
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ── WhatsApp — credenciais e operação (card cheio) ── */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              WhatsApp (UazAPI) — credenciais e operação
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Campos de conexão, ritmo de envio e botões de operação da fila.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <p className="text-[10px] text-muted-foreground">
                Quantas mensagens UM cliente pode receber por dia. Mudou de valor? A fila antiga se ajusta no próximo envio.
              </p>
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
              disabled={waImporting}
            >
              {waImporting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              Importar contatos
            </Button>
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
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-9 cursor-pointer text-muted-foreground"
              onClick={() => navigate("/admin/simulator")}
            >
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
        </CardContent>
      </Card>

      {/* ── Alertas de operação — o sistema avisa o admin por WhatsApp ── */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              Alertas de operação
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Quando o canal parar ou uma rodada de envio acumular falhas, o sistema
            avisa este WhatsApp automaticamente (com fallback por push no painel).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {alertLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando alertas…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="alert-phone" className="text-xs font-medium text-muted-foreground">
                  WhatsApp do admin <span className="text-muted-foreground/50">(com DDD)</span>
                </Label>
                <Input
                  id="alert-phone"
                  placeholder="(11) 98765-4321"
                  value={alertPhone}
                  onChange={(e) => setAlertPhone(e.target.value)}
                  className="h-9 text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Vazio = sem alertas. O aviso sai por este número mesmo fora da janela de
                  envio dos clientes — é operação, não lembrete.
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <Switch checked={alertChannelDown} onCheckedChange={setAlertChannelDown} className="cursor-pointer mt-0.5" />
                  <span className="text-xs leading-relaxed">
                    <span className="font-medium text-foreground">Avisar quando o canal parar</span>
                    <span className="block text-[10px] text-muted-foreground">
                      Instância desconectada (QR expirou) ou credenciais ausentes com fila pronta.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <Switch checked={alertDispatchFailures} onCheckedChange={setAlertDispatchFailures} className="cursor-pointer mt-0.5" />
                  <span className="text-xs leading-relaxed">
                    <span className="font-medium text-foreground">Avisar quando uma rodada acumular falhas</span>
                    <span className="block text-[10px] text-muted-foreground">
                      Dispara a partir de {alertThreshold} falha(s) na mesma rodada de envio.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <Switch checked={alertStuckQueue} onCheckedChange={setAlertStuckQueue} className="cursor-pointer mt-0.5" />
                  <span className="text-xs leading-relaxed">
                    <span className="font-medium text-foreground">Avisar quando a fila empacar</span>
                    <span className="block text-[10px] text-muted-foreground">
                      Avisos com horário agendado passado há mais de 12h — ou presos na fila há mais de 2 dias.
                    </span>
                  </span>
                </label>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <Switch checked={alertDailySummary} onCheckedChange={setAlertDailySummary} className="cursor-pointer mt-0.5" />
                <span className="text-xs leading-relaxed">
                  <span className="font-medium text-foreground">Resumo diário de cobranças</span>
                  <span className="block text-[10px] text-muted-foreground">
                    Uma vez por dia, junto da sincronização: vencem hoje, vencidas até 5 dias,
                    vencidas há mais de 5 e próximas — com valores.
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  Botões de ação rápida <span className="text-muted-foreground/50">(máx. 3, vão nos alertas)</span>
                </Label>
                {alertButtons.map((button, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Rótulo (ex: Abrir painel)"
                      value={button.label}
                      onChange={(e) => {
                        const next = [...alertButtons];
                        next[index] = { ...next[index], label: e.target.value };
                        setAlertButtons(next);
                      }}
                      className="h-9 flex-1 text-xs"
                    />
                    <Input
                      placeholder="URL (vazio = portal + atalho do alerta)"
                      value={button.url}
                      onChange={(e) => {
                        const next = [...alertButtons];
                        next[index] = { ...next[index], url: e.target.value };
                        setAlertButtons(next);
                      }}
                      className="h-9 flex-[1.6] text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setAlertButtons(alertButtons.filter((_, i) => i !== index))}
                      className="px-2 text-xs text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                      title="Remover botão"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {alertButtons.length < 3 ? (
                  <button
                    type="button"
                    onClick={() => setAlertButtons([...alertButtons, { label: "", url: "" }])}
                    className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    + Adicionar botão
                  </button>
                ) : null}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  URL vazia abre o portal com o atalho contextual (falhas → Mensagens, canal →
                  Conexões, resumo → Prévia). Sobre login direto no portal: o link abriria a
                  sessão de quem clicar — o login do cliente é individual, por segurança.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-medium text-muted-foreground">
                  Falhas para disparar o aviso
                </Label>
                <div className="flex items-center gap-2">
                  {[3, 5, 10, 20].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAlertThreshold(n)}
                      className={`h-8 min-w-10 rounded-md border px-2 text-xs font-mono cursor-pointer transition-colors ${
                        alertThreshold === n
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {Object.keys(alertLastSentAt).length > 0 ? (
                <div className="text-[10px] text-muted-foreground">
                  Últimos disparos:{" "}
                  {Object.entries(alertLastSentAt).map(([key, ts]) => (
                    <span key={key} className="mr-2">
                      {key === "channel-down"
                        ? "canal"
                        : key === "dispatch-failures"
                          ? "falhas"
                          : key === "daily-summary"
                            ? "resumo"
                            : "pausa"}{" "}
                      {new Date(ts).toLocaleString("pt-BR")};{" "}
                    </span>
                  ))}
                  (reavisa no máximo a cada 4h)
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="text-xs h-9 cursor-pointer" onClick={handleSaveAlerts} disabled={alertSaving}>
                  {alertSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Salvar alertas
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-9 cursor-pointer"
                  onClick={handleTestAlert}
                  disabled={alertTesting || !alertPhone.replace(/\D/g, "")}
                >
                  {alertTesting ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Enviar teste
                </Button>
              </div>
            </>
          )}
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

      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={(open) => {
          setRemoveDialogOpen(open);
          if (!open) setDeletingId(null);
        }}
        title="Remover esta conta MikWeb?"
        description="A conta sai do sync, das consultas e do portal. Os lembretes já enviados continuam no histórico."
        confirmLabel="Remover conta"
        onConfirm={handleDeleteConnection}
      >
        <p className="text-xs text-muted-foreground">
          Se esta for a última conta ativa, a remoção será recusada — desative ou remova
          outra antes.
        </p>
      </ConfirmDialog>

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
