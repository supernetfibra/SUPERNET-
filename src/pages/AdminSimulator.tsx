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
  validateRules,
  type SimItem,
  type SimParams,
  type SimReport,
  type SimRule,
  type SimSettings,
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

  const toggleDecision = (code: string) => {
    setDecisionFilter((current) =>
      current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code]
    );
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
          ) : null}

          <p className="text-[10px] text-muted-foreground">
            ligada · chave · evento · deslocamento em dias (negativo = antes do vencimento) ·
            prioridade · rótulo. A régua salva é a que o envio automático usará.
          </p>

          <div className="space-y-2">
            {params.rules.map((rule, index) => (
              <div key={`${rule.key}-${index}`} className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={rule.active}
                  onCheckedChange={(checked) => updateRule(index, { active: checked })}
                  className="cursor-pointer"
                />
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
          </div>

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
                  <Select value={ruleFilter} onValueChange={setRuleFilter}>
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
                    onChange={(e) => setSearch(e.target.value)}
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
                      filteredItems.map((item) => {
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
