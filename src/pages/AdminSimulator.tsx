/**
 * Admin — Simulador de lembretes de fatura (dry-run).
 *
 * Roda `GET /api/admin/notifications/simulate` e mostra o que SERIA enviado, para
 * quem, por qual canal e por que não para o resto. Nada é enviado nem gravado: o
 * endpoint é uma função pura dos dados (ver LEMBRETES-WHATSAPP.md §14).
 *
 * O ponto da tela é **comparar configurações antes de ligar o envio**:
 * "Fixar como referência" guarda o relatório atual e, a partir daí, cada rodada
 * nova aparece com a diferença (o que mudou de "ignorado" para "enviado", quanto a
 * fila passou a escoar, etc). Sem isso, mudar a cota de 20 para 50 seria um número
 * solto em vez de uma decisão.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FlaskConical,
  Loader2,
  Play,
  Pin,
  PinOff,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
  Search,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Settings2,
  RefreshCw,
  Send,
  MessageSquareText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiUrl } from "@/lib/api-config";
import { Textarea } from "@/components/ui/textarea";
import { AdminSyncDialog } from "@/components/AdminSyncDialog";
import { AdminDispatchDialog } from "@/components/AdminDispatchDialog";
import {
  buildDecisionChips,
  buildMetrics,
  buildRuleOptions,
  configQuery,
  decisionTone,
  describeSettingsOverrides,
  diffParams,
  filterItems,
  formatBRL,
  formatDateBR,
  paramsFromSettings,
  previewFallbackNote,
  renderTemplatePreview,
  validateRules,
  TEMPLATE_SAMPLE_PAYLOAD,
  TEMPLATE_MINIMAL_PAYLOAD,
  type SimItem,
  type SimParams,
  type SimReport,
  type SimRule,
  type SimSettings,
  type TemplateEditorItem,
  type TemplateEntry,
  type TemplatesState,
} from "@/lib/simulator-report";

// ---------------------------------------------------------------------------
// Helpers de API (mesmo padrão das outras páginas admin)
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

/** Rótulo curto do evento para o seletor do editor de mensagens. */
function templateEventLabel(eventKey: string): string {
  if (eventKey === "billing.due_soon") return "fatura a vencer";
  if (eventKey === "billing.due_today") return "vence hoje";
  if (eventKey === "billing.late") return "em atraso";
  return eventKey;
}

// ---------------------------------------------------------------------------
// Estado inicial e acesso à API
// ---------------------------------------------------------------------------

/**
 * O formulário começa vazio até a configuração persistida chegar; quem o preenche é
 * `paramsFromSettings()`. Assim os campos nunca nascem de constantes do código — que
 * era exatamente o que fazia a simulação divergir do envio real.
 */
const PLACEHOLDER_PARAMS: SimParams = {
  source: "mikweb",
  scenario: "realistic",
  today: "",
  horizon: 7,
  at: 10,
  cap: 20,
  perCustomerCap: 1,
  optIn: "auto",
  push: "auto",
  whatsapp: "on",
  instance: "up",
  lockedDays: 0,
  limitCustomers: 25,
  itemLimit: 500,
  previewLimit: 200,
  reveal: false,
  rules: [],
};

/**
 * Query da simulação.
 *
 * Parâmetro de configuração só é enviado quando DIVERGE do que está salvo — no
 * backend, ausente significa "use a configuração persistida". Uma rodada sem tocar em
 * nada é, literalmente, o pipeline de produção.
 */
function buildQuery(params: SimParams, baseline: SimSettings | null): string {
  const query = new URLSearchParams({
    source: params.source,
    scenario: params.scenario,
    "opt-in": params.optIn,
    push: params.push,
    instance: params.instance,
    "locked-days": String(params.lockedDays),
    "limit-customers": String(params.limitCustomers),
    "item-limit": String(params.itemLimit),
    "preview-limit": String(params.previewLimit),
    ...configQuery(params, baseline),
  });
  if (params.today) query.set("today", params.today);
  if (params.reveal) query.set("reveal", "1");
  return query.toString();
}

async function fetchSettings(): Promise<SimSettings> {
  const res = await adminFetch("/api/admin/notifications/settings");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Não foi possível ler a configuração."
    );
  }
  return data as SimSettings;
}

async function fetchReport(params: SimParams, baseline: SimSettings | null): Promise<SimReport> {
  const res = await adminFetch(`/api/admin/notifications/simulate?${buildQuery(params, baseline)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Não foi possível rodar a simulação."
    );
  }
  return data as SimReport;
}

export default function AdminSimulator() {
  const [params, setParams] = useState<SimParams>(PLACEHOLDER_PARAMS);
  const [runParams, setRunParams] = useState<SimParams | null>(null);
  const [report, setReport] = useState<SimReport | null>(null);
  const [reference, setReference] = useState<{ report: SimReport; params: SimParams } | null>(null);
  const [loading, setLoading] = useState(true);
  /** Edição técnica da régua (chave/evento/prioridade) recolhida: o simples é ligar/desligar. */
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Configuração persistida: é dela que os campos nascem e contra ela que se mede
  // "alterei algo nesta rodada?".
  const [baseline, setBaseline] = useState<SimSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotes, setSettingsNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [decisionFilter, setDecisionFilter] = useState<string[]>([]);
  const [ruleFilter, setRuleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  // ── Editor de mensagens (templates) ──
  const [templatesState, setTemplatesState] = useState<TemplatesState | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, TemplateEntry>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>("whatsapp:billing.late");
  const [templatesSaving, setTemplatesSaving] = useState(false);
  const [showMinimalSample, setShowMinimalSample] = useState(false);

  // Carrega uma vez: primeiro a configuração, depois a simulação com ela — é a
  // pergunta mais provável do admin ("o que sairia hoje, como está configurado?").
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let loaded: SimSettings | null = null;
      try {
        loaded = await fetchSettings();
      } catch (err) {
        if (!cancelled) {
          setSettingsError(
            err instanceof Error ? err.message : "Erro ao ler a configuração de notificações."
          );
        }
      }
      if (cancelled) return;
      setBaseline(loaded);

      const seeded = loaded ? paramsFromSettings(loaded) : PLACEHOLDER_PARAMS;
      setParams(seeded);
      try {
        const data = await fetchReport(seeded, loaded);
        if (cancelled) return;
        setReport(data);
        setRunParams(seeded);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao rodar a simulação.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpanded(null);
    // A base mudou: filtros antigos podem apontar para uma decisão/regra que não
    // existe mais nesta rodada, e o resultado seria uma tabela vazia enganosa.
    setDecisionFilter([]);
    setRuleFilter("all");
    setSearch("");
    try {
      const data = await fetchReport(params, baseline);
      setReport(data);
      setRunParams(params);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao rodar a simulação.");
    } finally {
      setLoading(false);
    }
  }, [params, baseline]);

  /**
   * Salva a régua e a agenda. Depois de salvar, o campo de régua passa a valer como
   * configuração persistida — as próximas rodadas não são mais override.
   */
  const saveRules = useCallback(async () => {
    setSaving(true);
    setSettingsNotes([]);
    try {
      const res = await adminFetch("/api/admin/notifications/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: params.rules,
          horizonDays: params.horizon,
          runAtHour: params.at,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Não foi possível salvar a configuração."
        );
      }
      setSettingsNotes(Array.isArray(data?.notes) ? (data.notes as string[]) : []);
      const fresh = await fetchSettings();
      setBaseline(fresh);
      // Re-semeia a régua do servidor: se a validação limitou algo, o formulário mostra
      // o que ficou gravado, não o que foi digitado.
      setParams((current) => ({ ...current, rules: fresh.rules.map((rule) => ({ ...rule })) }));
      toast.success(`Configuração salva (${fresh.fingerprint}).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }, [params.rules, params.horizon, params.at]);

  const ruleProblems = useMemo(
    () => validateRules(params.rules, baseline?.maxRules ?? 12),
    [params.rules, baseline?.maxRules]
  );

  // ── Editor de mensagens: carregar e derivar estado ──
  const loadTemplatesState = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/notifications/templates");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao ler os templates.");
      setTemplatesState(data as TemplatesState);
      setTemplatesError(null);
      setEditing({});
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "Erro ao ler os templates.");
    }
  }, []);

  useEffect(() => {
    void loadTemplatesState();
  }, [loadTemplatesState]);

  const templateItems: TemplateEditorItem[] = templatesState?.templates ?? [];

  /** Lista na ordem WhatsApp primeiro, eventos na ordem da régua (a vencer → hoje → atraso). */
  const orderedTemplates = useMemo(() => {
    const order = ["whatsapp", "push"];
    const eventOrder = ["billing.due_soon", "billing.due_today", "billing.late"];
    return [...templateItems].sort(
      (a, b) =>
        order.indexOf(a.channel) - order.indexOf(b.channel) ||
        eventOrder.indexOf(a.eventKey) - eventOrder.indexOf(b.eventKey)
    );
  }, [templateItems]);

  const currentTemplate = orderedTemplates.find((t) => t.key === selectedTemplate) ?? orderedTemplates[0] ?? null;

  /** O que está no editor agora: original do servidor ou versão em edição. */
  const editingTemplate = currentTemplate
    ? editing[currentTemplate.key] ?? { body: currentTemplate.body, ...(currentTemplate.title ? { title: currentTemplate.title } : {}), active: currentTemplate.active }
    : null;

  const previewPayload = showMinimalSample ? TEMPLATE_MINIMAL_PAYLOAD : TEMPLATE_SAMPLE_PAYLOAD;
  const livePreview = editingTemplate ? renderTemplatePreview(editingTemplate.body, previewPayload) : null;
  const liveTitle = editingTemplate?.title ? renderTemplatePreview(editingTemplate.title, previewPayload) : null;

  const updateEditing = (key: string, patch: Partial<TemplateEntry>) =>
    setEditing((current) => {
      const base = current[key] ?? { body: "", active: true };
      return { ...current, [key]: { ...base, ...patch } };
    });

  /**
   * Preenche o editor com o texto PADRÃO do código para este template. Não salva:
   * ao clicar em "Salvar mensagens", o servidor detecta a igualdade com o baseline e
   * REMOVE o override — daí o estado volta a ser "texto padrão" de verdade.
   */
  const resetTemplateToDefault = (key: string) => {
    const fallback = templatesState?.defaults?.[key];
    if (!fallback) return;
    updateEditing(key, {
      body: fallback.body,
      ...(fallback.title !== undefined ? { title: fallback.title } : {}),
      active: fallback.active,
    });
    toast.info("Texto padrão carregado — salve para aplicá-lo.");
  };

  /** O template atual diverge do padrão do código (editado no servidor ou no editor)? */
  const currentTemplateDiffersFromDefault = (() => {
    if (!currentTemplate || !editingTemplate) return false;
    const fallback = templatesState?.defaults?.[currentTemplate.key];
    if (!fallback) return false;
    return (
      editingTemplate.body !== fallback.body ||
      (editingTemplate.title ?? "") !== (fallback.title ?? "") ||
      editingTemplate.active !== fallback.active
    );
  })();

  const templatesDirty = Object.keys(editing).length > 0;

  /**
   * Divergência entre o texto que a rodada usou (salvo) e as edições não salvas do
   * editor. É o aviso "o preview acima não é o que a fila vai enviar até você salvar".
   */
  const pendingDiff = useMemo(() => {
    if (!report || !templatesState || !Object.keys(editing).length) return [];
    const savedByEvent = new Map(
      (report.settings.templates ?? [])
        .filter((t) => t.channel === "whatsapp")
        .map((t) => [t.eventKey, t.body])
    );
    return Object.entries(editing)
      .filter(([key, entry]) => {
        if (!key.startsWith("whatsapp:")) return false;
        const savedBody = savedByEvent.get(key.split(":")[1] ?? "");
        return savedBody !== undefined && savedBody !== entry.body;
      })
      .map(([key, entry]) => ({
        key,
        eventKey: key.split(":")[1] ?? key,
        saved: savedByEvent.get(key.split(":")[1] ?? "") ?? "",
        edited: entry.body,
      }));
  }, [report, templatesState, editing]);

  const saveTemplatesNow = useCallback(async () => {
    if (!Object.keys(editing).length) return;
    setTemplatesSaving(true);
    try {
      const res = await adminFetch("/api/admin/notifications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: editing }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao salvar os templates.");
      setTemplatesState((current) => (current ? { ...current, ...(data as Partial<TemplatesState>) } : (data as TemplatesState)));
      setEditing({});
      toast.success("Mensagens salvas — o próximo envio já sai com o novo texto.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar os templates.");
    } finally {
      setTemplatesSaving(false);
    }
  }, [editing]);
  const overrides = useMemo(
    () => describeSettingsOverrides(params, baseline),
    [params, baseline]
  );
  const rulesDirty = overrides.some((item) => item.includes("régua"));

  const updateRule = (index: number, patch: Partial<SimRule>) =>
    setParams((current) => ({
      ...current,
      rules: current.rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)),
    }));

  const addRule = () =>
    setParams((current) => {
      let suffix = current.rules.length + 1;
      while (current.rules.some((rule) => rule.key === `aviso_${suffix}`)) suffix++;
      return {
        ...current,
        rules: [
          ...current.rules,
          {
            key: `aviso_${suffix}`,
            eventKey: "billing.late",
            offsetDays: 15,
            active: false,
            sortOrder: (current.rules.length + 1) * 10,
            label: "novo aviso",
          },
        ],
      };
    });

  const removeRule = (index: number) =>
    setParams((current) => ({ ...current, rules: current.rules.filter((_, position) => position !== index) }));

  /** Volta ao documento padrão do código (sem salvar) — a comparação mostra o efeito. */
  const resetToDefaults = () => {
    if (!baseline) return;
    setParams((current) => ({
      ...current,
      rules: baseline.defaults.rules.map((rule) => ({ ...rule })),
      horizon: baseline.defaults.horizonDays,
      at: baseline.defaults.runAtHour,
    }));
    toast.info("Régua padrão carregada no formulário — rode a simulação e salve se quiser fixá-la.");
  };

  /** Descarta os overrides e volta ao que está salvo (é o que será enviado). */
  const resetToSaved = () => {
    if (!baseline) return;
    setParams(paramsFromSettings(baseline));
    toast.info("Campos restaurados para a configuração salva.");
  };

  const decisionChips = useMemo(
    () => (report ? buildDecisionChips(report) : []),
    [report]
  );

  const ruleOptions = useMemo(
    () => (report ? buildRuleOptions(report) : []),
    [report]
  );

  const filteredItems = useMemo(
    () =>
      report
        ? filterItems(report.items, {
            decisions: decisionFilter,
            ruleKey: ruleFilter,
            search,
          })
        : ([] as SimItem[]),
    [report, decisionFilter, ruleFilter, search]
  );

  /** Paginação da fila detalhada — 50 linhas por página. */
  const [itemPage, setItemPage] = useState(0);
  const ITEMS_PER_PAGE = 50;
  const totalItemPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const safeItemPage = Math.min(itemPage, totalItemPages - 1);
  const pagedItems = useMemo(
    () => filteredItems.slice(safeItemPage * ITEMS_PER_PAGE, (safeItemPage + 1) * ITEMS_PER_PAGE),
    [filteredItems, safeItemPage]
  );

  const toggleDecision = (code: string) => {
    setDecisionFilter((current) =>
      current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code]
    );
    setItemPage(0);
  };

  const downloadJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `simulacao-lembretes-${report.window.from}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório baixado em JSON.");
  };

  const metrics = report ? buildMetrics(report, reference?.report ?? null) : [];
  const paramChanges =
    reference && runParams ? diffParams(reference.params, runParams) : [];

  return (
    <div className="space-y-4 pb-24 md:pb-8">
      {/* ── Controles ── */}
      <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out]">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium tracking-tight">
              Simulador de lembretes
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Mostra o que <strong>seria</strong> enviado, com as regras, a cota e a janela atuais.
            Nada é enviado e nada é gravado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Fonte</Label>
              <Select
                value={params.source}
                onValueChange={(value) => setParams({ ...params, source: value as SimParams["source"] })}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mikweb" className="text-xs">Base real (MikWeb)</SelectItem>
                  <SelectItem value="synthetic" className="text-xs">Sintética</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Cenário {params.source === "mikweb" ? "(ignorado)" : ""}
              </Label>
              <Select
                value={params.scenario}
                onValueChange={(value) => setParams({ ...params, scenario: value as SimParams["scenario"] })}
                disabled={params.source === "mikweb"}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="realistic" className="text-xs">Realista (400 clientes)</SelectItem>
                  <SelectItem value="stress" className="text-xs">Estresse (5.000 clientes)</SelectItem>
                  <SelectItem value="edge" className="text-xs">Dados ruins (adversarial)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Data de referência
              </Label>
              <Input
                type="date"
                value={params.today}
                onChange={(e) => setParams({ ...params, today: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Horizonte (dias)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={params.horizon}
                onChange={(e) => setParams({ ...params, horizon: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Execução (h)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={params.at}
                onChange={(e) => setParams({ ...params, at: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Cota novas conversas
              </Label>
              <Input
                type="number"
                min={0}
                value={params.cap}
                onChange={(e) => setParams({ ...params, cap: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Cota por cliente</Label>
              <Input
                type="number"
                min={1}
                value={params.perCustomerCap}
                onChange={(e) => setParams({ ...params, perCustomerCap: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Opt-in</Label>
              <Select
                value={params.optIn}
                onValueChange={(value) => setParams({ ...params, optIn: value as SimParams["optIn"] })}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs">O que a base diz</SelectItem>
                  <SelectItem value="all" className="text-xs">Todos aceitaram</SelectItem>
                  <SelectItem value="none" className="text-xs">Ninguém aceitou</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Push</Label>
              <Select
                value={params.push}
                onValueChange={(value) => setParams({ ...params, push: value as SimParams["push"] })}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs">O que a base diz</SelectItem>
                  <SelectItem value="all" className="text-xs">Todos inscritos</SelectItem>
                  <SelectItem value="none" className="text-xs">Nenhum inscrito</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Canal WhatsApp</Label>
              <Select
                value={params.whatsapp}
                onValueChange={(value) => setParams({ ...params, whatsapp: value as SimParams["whatsapp"] })}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on" className="text-xs">Ligado</SelectItem>
                  <SelectItem value="off" className="text-xs">Desligado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Instância</Label>
              <Select
                value={params.instance}
                onValueChange={(value) => setParams({ ...params, instance: value as SimParams["instance"] })}
              >
                <SelectTrigger className="h-9 text-xs cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="up" className="text-xs">Conectada</SelectItem>
                  <SelectItem value="down" className="text-xs">Desconectada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">Time-lock (dias)</Label>
              <Input
                type="number"
                min={0}
                value={params.lockedDays}
                onChange={(e) => setParams({ ...params, lockedDays: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Clientes varridos
              </Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={params.limitCustomers}
                onChange={(e) => setParams({ ...params, limitCustomers: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Itens no relatório
              </Label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={params.itemLimit}
                onChange={(e) => setParams({ ...params, itemLimit: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-medium text-muted-foreground">
                Mensagens renderizadas
              </Label>
              <Input
                type="number"
                min={0}
                max={200}
                value={params.previewLimit}
                onChange={(e) => setParams({ ...params, previewLimit: Number(e.target.value) })}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={run}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              Rodar simulação
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer"
              disabled={!report || loading}
              onClick={() => {
                if (!report || !runParams) return;
                setReference({ report, params: runParams });
                toast.success("Relatório fixado como referência. Mude os parâmetros e rode de novo.");
              }}
            >
              <Pin className="h-3.5 w-3.5 mr-1.5" />
              Fixar como referência
            </Button>

            {reference ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-9 cursor-pointer"
                onClick={() => setReference(null)}
              >
                <PinOff className="h-3.5 w-3.5 mr-1.5" />
                Soltar referência
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer"
              onClick={downloadJson}
              disabled={!report}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Baixar JSON
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setSyncOpen(true)}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Sincronizar agora
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 cursor-pointer border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setDispatchOpen(true)}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Disparar fila outbox
            </Button>

            {overrides.length ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-9 cursor-pointer"
                onClick={resetToSaved}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Voltar ao que está salvo
              </Button>
            ) : null}

            <div className="flex items-center gap-2 ml-auto">
              <Switch
                checked={params.reveal}
                onCheckedChange={(checked) => setParams({ ...params, reveal: checked })}
                className="cursor-pointer"
              />
              <span className="text-[10px] text-muted-foreground">
                mostrar telefone completo
              </span>
            </div>
          </div>

          {overrides.length ? (
            <div className="flex items-start gap-2 rounded-sm border border-amber-500/30 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Esta rodada não é o que está salvo:</p>
                <ul className="space-y-0.5">
                  {overrides.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  O relatório registra esses overrides — enquanto não forem salvos, o envio real
                  segue a configuração salva.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Sem overrides: esta rodada usa exatamente a configuração persistida
              {baseline ? ` (${baseline.fingerprint})` : ""} — é o que será enviado.
            </p>
          )}

          {params.cap === 0 ? (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Cota 0 = sem limite de novas conversas. É o cenário que mais arrisca restrição do
              número pelo WhatsApp — use só para medir o teto.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Régua de lembretes: a configuração que a simulação e o envio usam ── */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium tracking-tight">
                  Régua de lembretes
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                {baseline ? (
                  <>
                    {baseline.origin === "db"
                      ? "Configuração salva no painel"
                      : "Régua padrão do código (nada salvo ainda)"}{" "}
                    · <span className="font-mono">{baseline.fingerprint}</span>
                    {baseline.updatedAt
                      ? ` · salva em ${new Date(baseline.updatedAt).toLocaleString("pt-BR")}${baseline.updatedBy ? ` por ${baseline.updatedBy}` : ""}`
                      : ""}
                  </>
                ) : (
                  "Lendo a configuração…"
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8 cursor-pointer"
                disabled={!baseline || saving}
                onClick={resetToDefaults}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Régua padrão
              </Button>
              <Button
                size="sm"
                className="text-xs h-8 cursor-pointer"
                disabled={!baseline || saving || !rulesDirty || ruleProblems.length > 0}
                onClick={saveRules}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Salvar régua
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsError ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {settingsError} Os campos abaixo continuam no padrão do formulário, e a rodada sai
              marcada como override — o que está salvo não pôde ser lido.
            </p>
          ) : null}          <p className="text-[10px] text-muted-foreground">
            Ligue ou desligue cada aviso da régua. A régua salva é a que o envio automático usará.
          </p>

          {/* Visão SIMPLES: um cartão por regra, com toggle e descrição em português.
              A edição técnica (chave/evento/prioridade/rótulo) fica no modo avançado. */}
          <div className="space-y-2">
            {params.rules.map((rule, index) => {
              const offsetLabel =
                rule.offsetDays === 0
                  ? "no dia do vencimento"
                  : rule.offsetDays > 0
                    ? `${rule.offsetDays} dia${rule.offsetDays > 1 ? "s" : ""} após o vencimento`
                    : `${Math.abs(rule.offsetDays)} dia${Math.abs(rule.offsetDays) > 1 ? "s" : ""} antes do vencimento`;
              const eventLabel =
                rule.eventKey === "billing.due_soon"
                  ? "Aviso de aproximação"
                  : rule.eventKey === "billing.due_today"
                    ? "Lembrete do dia"
                    : rule.eventKey === "billing.late"
                      ? "Aviso de atraso"
                      : rule.eventKey;
              return (
                <div
                  key={`${rule.key}-${index}`}
                  className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5 transition-colors ${
                    rule.active ? "border-border bg-background" : "border-border/50 bg-muted/30"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${rule.active ? "text-foreground" : "text-muted-foreground"}`}>
                      {rule.label || eventLabel}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {eventLabel} · {offsetLabel}
                    </p>
                  </div>
                  <Switch
                    checked={rule.active}
                    onCheckedChange={(checked) => updateRule(index, { active: checked })}
                    className="cursor-pointer shrink-0"
                  />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedRules((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showAdvancedRules ? "" : "-rotate-90"}`} />
            Editar avançado (chave, evento, prioridade, rótulo)
          </button>
          {showAdvancedRules && (
            <div className="space-y-2">
              {params.rules.map((rule, index) => (
                <div key={`adv-${rule.key}-${index}`} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={rule.key}
                    onChange={(event) =>
                      updateRule(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })
                    }
                    className="h-8 w-28 text-xs font-mono"
                    placeholder="chave"
                  />
                  <Select
                    value={rule.eventKey}
                    onValueChange={(value) => updateRule(index, { eventKey: value })}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(baseline?.eventKeys ?? [rule.eventKey]).map((eventKey) => (
                        <SelectItem key={eventKey} value={eventKey} className="text-xs">
                          {eventKey}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={-60}
                      max={60}
                      value={rule.offsetDays}
                      onChange={(event) => updateRule(index, { offsetDays: Number(event.target.value) })}
                      className="h-8 w-16 text-xs font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground">d</span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    value={rule.sortOrder}
                    onChange={(event) => updateRule(index, { sortOrder: Number(event.target.value) })}
                    className="h-8 w-16 text-xs font-mono"
                    title="Prioridade na fila (menor primeiro)"
                  />
                  <Input
                    value={rule.label}
                    onChange={(event) => updateRule(index, { label: event.target.value })}
                    className="h-8 flex-1 min-w-40 text-xs"
                    placeholder="rótulo para o painel"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 cursor-pointer text-muted-foreground hover:text-red-600"
                    onClick={() => removeRule(index)}
                    title="Remover regra"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 cursor-pointer"
                disabled={!baseline || params.rules.length >= (baseline?.maxRules ?? 12)}
                onClick={addRule}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Adicionar regra
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 cursor-pointer"
              disabled={!baseline || params.rules.length >= (baseline?.maxRules ?? 12)}
              onClick={addRule}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Adicionar regra
            </Button>
            {!params.rules.some((rule) => rule.active) ? (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                Nenhuma regra ligada: o pipeline não geraria nenhum aviso.
              </span>
            ) : null}
          </div>

          {ruleProblems.length ? (
            <ul className="space-y-0.5 text-[10px] text-red-600 dark:text-red-400">
              {ruleProblems.map((problem) => (
                <li key={problem}>• {problem}</li>
              ))}
            </ul>
          ) : null}

          {settingsNotes.length ? (
            <ul className="space-y-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              {settingsNotes.map((note) => (
                <li key={note}>• salvo com ajuste: {note}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-[10px] text-muted-foreground">
            Cota de novas conversas, janela de envio e canal ligado/desligado são do canal e vivem em{" "}
            <span className="font-medium">Configurações › WhatsApp</span> — aqui elas aparecem apenas
            como override de cenário.
          </p>
        </CardContent>
      </Card>

      {/* ── Mensagens: preview + edição por opção da régua ── */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium tracking-tight">Mensagens</CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                {templatesState?.origin === "db"
                  ? "Textos salvos no painel"
                  : "Textos padrão do código (nada salvo ainda)"}{" "}
                · prévia com dados de exemplo · o que salvar aqui é o que a fila envia
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {templatesDirty ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8 cursor-pointer"
                  onClick={() => setEditing({})}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Descartar
                </Button>
              ) : null}
              <Button
                size="sm"
                className="text-xs h-8 cursor-pointer"
                disabled={!templatesDirty || templatesSaving}
                onClick={saveTemplatesNow}
              >
                {templatesSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Salvar mensagens
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {templatesError ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {templatesError} O simulador continua funcionando com os textos padrão do código.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="h-8 w-64 text-xs cursor-pointer">
                <SelectValue placeholder="escolha a mensagem" />
              </SelectTrigger>
              <SelectContent>
                {orderedTemplates.map((template) => (
                  <SelectItem key={template.key} value={template.key} className="text-xs">
                    {template.channel === "whatsapp" ? "WhatsApp" : "Push"} · {templateEventLabel(template.eventKey)}
                    {template.edited || editing[template.key] ? " •" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentTemplate ? (
              <Switch
                checked={editingTemplate?.active ?? currentTemplate.active}
                onCheckedChange={(checked) => updateEditing(currentTemplate.key, { active: checked })}
                className="cursor-pointer"
              />
            ) : null}
            <span className="text-[10px] text-muted-foreground">
              {currentTemplate?.edited || (currentTemplate && editing[currentTemplate.key]) ? "editado" : "texto padrão"}
            </span>
            {currentTemplateDiffersFromDefault ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 cursor-pointer"
                onClick={() => resetTemplateToDefault(currentTemplate.key)}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Voltar ao padrão
              </Button>
            ) : null}
          </div>

          {currentTemplate && editingTemplate ? (
            <>
              <div className="space-y-2">
                <Label className="text-[10px] font-medium text-muted-foreground">
                  Corpo da mensagem — {"{{campo}}"} substitui, {"{{#campo}}…{{/campo}}"} é opcional
                </Label>
                <Textarea
                  value={editingTemplate.body}
                  onChange={(event) => updateEditing(currentTemplate.key, { body: event.target.value })}
                  className="min-h-44 text-xs font-mono"
                  spellCheck={false}
                />
                {currentTemplate.channel === "push" ? (
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-medium text-muted-foreground">Título do push</Label>
                    <Input
                      value={editingTemplate.title ?? ""}
                      onChange={(event) => updateEditing(currentTemplate.key, { title: event.target.value })}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                ) : null}
                {livePreview?.missing.length ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Campo desconhecido: {livePreview.missing.map((key) => `{{${key}}}`).join(", ")} — será enviado vazio.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-[10px] font-medium text-muted-foreground">Prévia (como o cliente recebe)</Label>
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showMinimalSample}
                      onChange={(event) => setShowMinimalSample(event.target.checked)}
                      className="accent-foreground"
                    />
                    simular fatura sem Pix/boleto
                  </label>
                </div>
                <div className="rounded-sm border border-border bg-muted/30 p-3 whitespace-pre-wrap text-xs leading-relaxed">
                  {currentTemplate.channel === "push" && liveTitle?.body ? (
                    <p className="font-medium mb-1">{liveTitle.body}</p>
                  ) : null}
                  {livePreview?.body}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TEMPLATE_SAMPLE_PAYLOAD).map(([key, value]) => (
                  <span
                    key={key}
                    title={value}
                    className="px-1.5 py-0.5 rounded-sm border border-border text-[10px] font-mono text-muted-foreground"
                  >
                    {key}
                  </span>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">Carregando mensagens…</p>
          )}
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-border shadow-none">
          <CardContent className="flex items-start gap-2 py-4 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p>{error}</p>
              {error.toLowerCase().includes("mikweb") ? (
                <p className="text-muted-foreground">
                  A base real exige as credenciais da MikWeb (secrets ou aba Configurações). Sem
                  elas, use a fonte sintética.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading && !report ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {report ? (
        <>
          {/* ── Números ── */}
          <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.05s_both]">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium tracking-tight">
                Resultado da simulação
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Configuração <span className="font-mono">{report.settings.fingerprint}</span> (
                {report.settings.origin === "db" ? "salva" : "padrão do código"})
                {report.overrides.length ? ` · ${report.overrides.length} override(s)` : " · sem override"}{" "}
                — janela {formatDateBR(report.window.from)} → {formatDateBR(report.window.to)} ·{" "}
                {report.window.days} dias · execução às {report.window.runAtHour}h · base{" "}
                {report.source.kind}/{report.source.strategy}: {report.source.billingsScanned} faturas
                de {report.source.customersScanned} clientes
                {report.source.truncated ? " (amostra truncada)" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {metrics.map((metric) => (
                  <div key={metric.label} className="space-y-1">
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {metric.label}
                    </p>
                    <p
                      className={`font-mono tabular-nums ${
                        metric.emphasis ? "text-xl text-foreground" : "text-base text-foreground"
                      }`}
                    >
                      {metric.value}
                    </p>
                    {metric.delta !== null && metric.delta !== 0 ? (
                      <p
                        className={`text-[10px] font-mono ${
                          metric.delta > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {metric.delta > 0 ? "▲" : "▼"} {Math.abs(metric.delta)} vs referência
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              {report.queue.exhaustionDays ? (
                <div className="flex items-start gap-2 rounded-sm border border-amber-500/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    A cota de {report.queue.newChatQuotaPerDay} novas conversas por dia leva ~
                    {report.queue.exhaustionDays} dias para escoar {report.queue.newChatCandidates}{" "}
                    candidatos. Adiar além do vencimento cancela avisos — veja os ignorados por
                    perder validade abaixo.
                  </span>
                </div>
              ) : null}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px] text-muted-foreground">
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Faturas</p>
                  <p>{report.plan.billingsOpen} em aberto</p>
                  <p>{report.plan.billingsPaid} pagas</p>
                  <p>{report.plan.billingsCanceled} canceladas</p>
                  <p>{report.plan.billingsUnknownSituation} situação desconhecida</p>
                  <p>{report.plan.billingsInvalidDueDate} vencimento inválido</p>
                  <p>{report.plan.staleBillings} antigas (fora do alcance)</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Alcance</p>
                  <p>{report.reach.withWhatsappOptIn} com opt-in de WhatsApp</p>
                  <p>{report.reach.withValidPhone} com celular válido</p>
                  <p>{report.reach.withPush} com push</p>
                  <p>{report.reach.alreadyHaveConversation} já com conversa aberta</p>
                  {Object.entries(report.reach.phoneFailures).length ? (
                    <p>
                      telefone:{" "}
                      {Object.entries(report.reach.phoneFailures)
                        .map(([reason, count]) => `${count} ${reason}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Canal</p>
                  <p>{report.whatsapp.enabled ? "ligado" : "desligado"}</p>
                  <p>
                    instância {report.whatsapp.instanceConnected ? "conectada" : "desconectada"}
                  </p>
                  <p>
                    janela {report.whatsapp.windowStart}h–{report.whatsapp.windowEnd}h
                  </p>
                  <p>cota {report.whatsapp.newChatCapPerDay}/dia</p>
                  <p>{report.whatsapp.perCustomerCapPerDay}/cliente/dia</p>
                  {report.whatsapp.pausedUntil ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      pausado até {formatDateBR(report.whatsapp.pausedUntil.slice(0, 10))}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Adiamentos</p>
                  <p>{report.queue.deferredByCap} por cota</p>
                  <p>{report.queue.deferredByWindow} por janela</p>
                  {Object.entries(report.byRule).map(([rule, count]) => (
                    <p key={rule}>
                      {rule}: {count} {report.itemsTruncated ? "(janela)" : ""}
                    </p>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground">
                Régua em vigor:{" "}
                <span className="font-mono break-words">
                  {report.settings.rules
                    .filter((rule) => rule.active)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((rule) => `${rule.key}(${rule.offsetDays > 0 ? "+" : ""}${rule.offsetDays}d)`)
                    .join(" · ") || "nenhuma regra ligada"}
                </span>
              </p>
            </CardContent>
          </Card>

          {/* ── Comparação com a referência ── */}
          {reference ? (
            <Card className="border-border shadow-none">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-medium tracking-tight">
                  Comparação com a referência
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Referência de {new Date(reference.report.generatedAt).toLocaleString("pt-BR")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {paramChanges.length ? (
                  <ul className="space-y-0.5 text-muted-foreground">
                    {paramChanges.map((change) => (
                      <li key={change} className="font-mono text-[10px]">
                        · {change}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Mesma configuração — a diferença abaixo vem só da base de dados.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {metrics
                    .filter((metric) => metric.delta !== null && metric.delta !== 0)
                    .map((metric) => (
                      <span
                        key={metric.label}
                        className={`text-[10px] px-2 py-0.5 rounded-sm border ${
                          metric.delta! > 0
                            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                            : "border-red-500/30 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {metric.label}: {metric.delta! > 0 ? "+" : ""}
                        {metric.delta}
                      </span>
                    ))}
                  {metrics.every((metric) => !metric.delta) ? (
                    <span className="text-[10px] text-muted-foreground">sem diferença</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* ── O que a simulação não sabe ── */}
          {report.assumptions.length ? (
            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium tracking-tight">
                    Suposições
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  O que a simulação não conseguiu ler — leia antes de decidir.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-[11px] text-muted-foreground">
                  {report.assumptions.map((assumption) => (
                    <li key={assumption}>• {assumption}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {report.templateWarnings.length ? (
            <Card className="border-border shadow-none">
              <CardContent className="flex items-start gap-2 py-4 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Atenção nos templates</p>
                  <ul className="space-y-0.5 text-[11px]">
                    {report.templateWarnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {pendingDiff.length ? (
            <Card className="border-amber-500/40 shadow-none">
              <CardContent className="flex items-start gap-2 py-4 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1.5">
                  <p className="font-medium">
                    O preview usa o texto SALVO, mas há edições não salvas para:{" "}
                    {pendingDiff.map((entry) => templateEventLabel(entry.eventKey)).join(", ")}
                  </p>
                  <p className="text-muted-foreground">
                    A fila envia o texto salvo — salve no card "Mensagens" para o novo texto valer
                    no envio (e no fingerprint da configuração).
                  </p>
                  {pendingDiff.map((entry) => (
                    <details key={entry.key} className="rounded-sm border border-border">
                      <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium">
                        {templateEventLabel(entry.eventKey)} — ver textos
                      </summary>
                      <div className="grid gap-2 p-2 text-[10px]">
                        <div>
                          <p className="font-medium text-muted-foreground">Salvo (o que a fila envia):</p>
                          <pre className="mt-1 whitespace-pre-wrap rounded-sm bg-muted/40 p-2 font-mono">{entry.saved}</pre>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground">Sua edição (não salva):</p>
                          <pre className="mt-1 whitespace-pre-wrap rounded-sm bg-muted/40 p-2 font-mono">{entry.edited}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* ── Fila ── */}
          <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.1s_both]">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium tracking-tight">
                Fila detalhada
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                {filteredItems.length} de {report.items.length} avisos
                {report.itemsTruncated
                  ? " — relatório truncado: o resumo acima conta a janela inteira, a tabela só os primeiros items"
                  : ""}{" "}
                · clique para ver a mensagem
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDecisionFilter([])}
                  className={`text-[10px] px-2 py-1 rounded-sm border cursor-pointer transition-colors ${
                    decisionFilter.length === 0
                      ? "border-foreground/40 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  tudo ({report.items.length})
                </button>
                {decisionChips.map((chip) => {
                  const active = decisionFilter.includes(chip.code);
                  return (
                    <button
                      key={chip.code}
                      type="button"
                      onClick={() => toggleDecision(chip.code)}
                      className={`text-[10px] px-2 py-1 rounded-sm border cursor-pointer transition-colors ${
                        active
                          ? `${decisionTone(chip.code)} border-foreground/40`
                          : `${decisionTone(chip.code)} border-transparent opacity-70 hover:opacity-100`
                      }`}
                    >
                      {chip.label} ({chip.count})
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <Select value={ruleFilter} onValueChange={(v) => { setRuleFilter(v); setItemPage(0); }}>
                    <SelectTrigger className="h-8 text-xs cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">todas as regras</SelectItem>
                      {ruleOptions.map((rule) => (
                        <SelectItem key={rule.key} value={rule.key} className="text-xs">
                          {rule.key} ({rule.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Cliente, referência ou CPF"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setItemPage(0);
                    }}
                    className="h-8 text-xs pl-8"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-sm border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] h-8 w-8" />
                      <TableHead className="text-[10px] h-8">Envio</TableHead>
                      <TableHead className="text-[10px] h-8">Cliente</TableHead>
                      <TableHead className="text-[10px] h-8 hidden sm:table-cell">Ref</TableHead>
                      <TableHead className="text-[10px] h-8 hidden md:table-cell">Venc.</TableHead>
                      <TableHead className="text-[10px] h-8 hidden sm:table-cell">Valor</TableHead>
                      <TableHead className="text-[10px] h-8 hidden lg:table-cell">Regra</TableHead>
                      <TableHead className="text-[10px] h-8">Decisão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-xs text-muted-foreground text-center py-8">
                          Nenhum aviso com os filtros atuais.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedItems.map((item) => {
                        const isOpen = expanded === item.dedupeKey;
                        return (
                          <Fragment key={item.dedupeKey}>
                            <TableRow
                              className="cursor-pointer"
                              onClick={() => setExpanded(isOpen ? null : item.dedupeKey)}
                            >
                              <TableCell className="py-2 px-2">
                                {isOpen ? (
                                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] font-mono tabular-nums whitespace-nowrap">
                                {item.sendDateBR}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] max-w-[180px] truncate">
                                {item.customerName}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] font-mono hidden sm:table-cell">
                                {item.reference}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] font-mono hidden md:table-cell whitespace-nowrap">
                                {item.dueDateBR}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] font-mono tabular-nums hidden sm:table-cell whitespace-nowrap">
                                {formatBRL(item.valueWithCharges)}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] font-mono hidden lg:table-cell">
                                {item.ruleKey}
                              </TableCell>
                              <TableCell className="py-2">
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap ${decisionTone(
                                    item.decision
                                  )}`}
                                >
                                  {item.decisionLabel}
                                </span>
                              </TableCell>
                            </TableRow>
                            {isOpen ? (
                              <TableRow>
                                <TableCell colSpan={8} className="bg-muted/30">
                                  <div className="space-y-2 py-1">
                                    <p className="text-[11px] text-muted-foreground">
                                      {item.reason}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground font-mono">
                                      <span className="px-1.5 py-0.5 rounded-sm border border-border">
                                        {item.phone ?? item.phoneMasked ?? "sem telefone"}
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded-sm border border-border">
                                        {item.eventKey}
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded-sm border border-border">
                                        {item.dedupeKey}
                                      </span>
                                      {item.inNewChatQuota ? (
                                        <span className="px-1.5 py-0.5 rounded-sm border border-amber-500/30 text-amber-600 dark:text-amber-400">
                                          consome cota de nova conversa
                                        </span>
                                      ) : null}
                                      {item.cpfMasked ? (
                                        <span className="px-1.5 py-0.5 rounded-sm border border-border">
                                          {item.cpfMasked}
                                        </span>
                                      ) : null}
                                    </div>
                                    {item.preview?.body ? (
                                      <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed rounded-sm border border-border bg-background p-3 text-foreground">
                                        {item.preview.title ? `${item.preview.title}\n\n` : ""}
                                        {item.preview.body}
                                      </pre>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground">
                                        {previewFallbackNote(
                                          item,
                                          runParams?.previewLimit ?? params.previewLimit
                                        )}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Paginação — o total continua sendo o resumo; a tabela mostra uma página por vez */}
              {filteredItems.length > ITEMS_PER_PAGE ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>
                    página {safeItemPage + 1} de {totalItemPages} · {filteredItems.length} avisos filtrados
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] cursor-pointer"
                      disabled={safeItemPage === 0}
                      onClick={() => setItemPage(safeItemPage - 1)}
                    >
                      ← anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] cursor-pointer"
                      disabled={safeItemPage >= totalItemPages - 1}
                      onClick={() => setItemPage(safeItemPage + 1)}
                    >
                      próxima →
                    </Button>
                  </div>
                </div>
              ) : null}

              {report.skippedSamples.length ? (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer text-[10px]">
                    amostra de ignorados/adiados
                  </summary>
                  <ul className="mt-2 space-y-0.5 font-mono">
                    {report.skippedSamples.map((sample, index) => (
                      <li key={`${sample.ruleKey}-${index}`}>
                        {sample.customerName} · {sample.ruleKey} → {sample.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground text-center">
            relatório gerado em{" "}
            {new Date(report.generatedAt).toLocaleString("pt-BR")} · simulador v
            {report.simulatorVersion} · nada foi enviado nem gravado
          </p>
        </>
      ) : null}

      <AdminSyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onOpenDispatch={() => {
          setDispatchOpen(true);
        }}
      />

      <AdminDispatchDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
      />
    </div>
  );
}
