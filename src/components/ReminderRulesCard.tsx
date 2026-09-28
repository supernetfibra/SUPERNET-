/**
 * Card "Régua de lembretes" — vive em Configurações › Lembretes por WhatsApp.
 *
 * Movido do Simulador: o que define produção (a régua que o cron de 08h lê) pertence
 * à tela de configuração. O simulador continua podendo EXPLORAR cenários de régua,
 * mas não salva — aqui é o único lugar que grava.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, Settings2, ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiUrl } from "@/lib/api-config";
import {
  paramsFromSettings,
  validateRules,
  type SimParams,
  type SimSettings,
  type SimRule,
} from "@/lib/simulator-report";

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

export function ReminderRulesCard() {
  const [baseline, setBaseline] = useState<SimSettings | null>(null);
  const [rules, setRules] = useState<SimRule[]>([]);
  const [horizon, setHorizon] = useState(7);
  const [runAtHour, setRunAtHour] = useState(10);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Edição técnica (chave/evento/prioridade/rótulo) recolhida: o simples é ligar/desligar. */
  const [showAdvanced, setShowAdvanced] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/notifications/settings");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao ler a régua.");
      const settings = data as SimSettings;
      setBaseline(settings);
      const params: SimParams = paramsFromSettings(settings);
      setRules(params.rules.map((rule) => ({ ...rule })));
      setHorizon(settings.horizonDays ?? 7);
      setRunAtHour(settings.runAtHour ?? 10);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Erro ao ler a régua.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/notifications/settings");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro ao ler a régua.");
        const settings = data as SimSettings;
        setBaseline(settings);
        const params: SimParams = paramsFromSettings(settings);
        setRules(params.rules.map((rule) => ({ ...rule })));
        setHorizon(settings.horizonDays ?? 7);
        setRunAtHour(settings.runAtHour ?? 10);
        setSettingsError(null);
      } catch (err) {
        setSettingsError(err instanceof Error ? err.message : "Erro ao ler a régua.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    const params: SimParams = paramsFromSettings(baseline);
    return (
      JSON.stringify(params.rules) !== JSON.stringify(rules) ||
      params.horizon !== horizon ||
      params.at !== runAtHour
    );
  }, [baseline, rules, horizon, runAtHour]);

  const problems = useMemo(() => validateRules(rules, baseline?.maxRules ?? 12), [rules, baseline?.maxRules]);

  const updateRule = (index: number, patch: Partial<SimRule>) =>
    setRules((current) => current.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/notifications/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, horizonDays: horizon, runAtHour }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Não foi possível salvar a régua.");
      }
      const notes = Array.isArray(data?.notes) ? (data.notes as string[]) : [];
      await loadSettings();
      toast.success(`Régua salva — o envio automático já usa esta configuração.${notes.length ? ` Notas: ${notes.join("; ")}` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar a régua.");
    } finally {
      setSaving(false);
    }
  }, [rules, horizon, runAtHour, loadSettings]);

  return (
    <Card className="border-border shadow-none animate-[slideUp_0.3s_ease-out_0.2s_both]">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Régua de lembretes</CardTitle>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              {baseline ? (
                <>
                  {baseline.origin === "db" ? "Salva no painel" : "Padrão do código (nada salvo ainda)"}{" "}
                  · <span className="font-mono">{baseline.fingerprint}</span> — é o que o envio
                  automático (cron 08h) usa
                </>
              ) : (
                "Lendo a régua…"
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 cursor-pointer"
              disabled={!baseline || saving}
              onClick={() => {
                if (!baseline) return;
                const params: SimParams = paramsFromSettings(baseline);
                setRules(params.rules.map((rule) => ({ ...rule })));
                setHorizon(params.horizon);
                setRunAtHour(params.at);
                toast.info("Voltou ao que está salvo.");
              }}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Descartar
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 cursor-pointer"
              disabled={!baseline || saving || !dirty || problems.length > 0}
              onClick={save}
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
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{settingsError}</p>
        ) : null}
        {loading ? <p className="text-[11px] text-muted-foreground">Carregando…</p> : null}

        {/* Visão SIMPLES: um cartão por regra, com toggle e descrição em português */}
        <div className="space-y-2">
          {rules.map((rule, index) => {
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
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "" : "-rotate-90"}`} />
          Editar avançado (chave, evento, prioridade, rótulo)
        </button>
        {showAdvanced ? (
          <div className="space-y-2">
            {rules.map((rule, index) => (
              <div key={`adv-${rule.key}-${index}`} className="flex flex-wrap items-center gap-2">
                <Input
                  value={rule.key}
                  onChange={(event) =>
                    updateRule(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })
                  }
                  className="h-8 w-28 text-xs font-mono"
                  placeholder="chave"
                />
                <Select value={rule.eventKey} onValueChange={(value) => updateRule(index, { eventKey: value })}>
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
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium text-muted-foreground">Horizonte (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium text-muted-foreground">Execução (h)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={runAtHour}
                  onChange={(e) => setRunAtHour(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        ) : null}

        {problems.length ? (
          <ul className="space-y-0.5 text-[10px] text-red-600 dark:text-red-400">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
        {!rules.some((rule) => rule.active) && rules.length ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            Nenhuma regra ligada: o pipeline não geraria nenhum aviso.
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
