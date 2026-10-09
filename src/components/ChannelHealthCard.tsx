/**
 * ChannelHealthCard — "o canal vai entregar hoje?" em um olhar.
 *
 * Consome GET /api/admin/whatsapp/health (score + checklist). Cada checagem
 * quebrada traz ONDE resolver (rota do painel): o card é atalho, não relatório.
 * Estados: carregando, migration pendente/erro (silencioso com retry manual),
 * e o resultado — verde quando tudo crítico ok, âmbar com pendências, vermelho
 * quando um crítico quebra.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminFetch } from "@/lib/api-config";

interface HealthCheck {
  key: string;
  label: string;
  ok: boolean;
  fix?: string;
  detail?: string;
  critical?: boolean;
  informational?: boolean;
}

interface HealthReport {
  ok: boolean;
  score: number;
  checks: HealthCheck[];
  summary: string;
}

export function ChannelHealthCard() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminFetch("/api/admin/whatsapp/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { health?: HealthReport };
      if (!data.health) throw new Error("sem relatório");
      setHealth(data.health);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scoring = health?.checks.filter((c) => !c.informational) ?? [];
  const broken = scoring.filter((c) => !c.ok);
  const tone = !health ? "muted" : health.ok ? "ok" : broken.some((c) => c.critical) ? "bad" : "warn";

  return (
    <Card className="shadow-none animate-[slideUp_0.3s_ease-out_0.05s_both]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Saúde do WhatsApp
          </CardTitle>
          <div className="flex items-center gap-2">
            {health ? (
              <Badge
                variant="outline"
                className={
                  tone === "ok"
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : tone === "bad"
                      ? "border-red-500/40 text-red-600 dark:text-red-400"
                      : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                }
              >
                {health.score}/100
              </Badge>
            ) : null}
            <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => void load()} aria-label="Recarregar saúde do canal">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          {loading && !health
            ? "Verificando o canal…"
            : failed
              ? "Não foi possível avaliar agora — tente recarregar."
              : (health?.summary ?? "")}
        </CardDescription>
      </CardHeader>
      {health ? (
        <CardContent className="space-y-1.5 pt-0">
          {health.checks.map((check) => (
            <div key={check.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                {check.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : check.informational ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                ) : check.critical ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span className={`truncate ${check.ok ? "text-muted-foreground" : "font-medium"}`}>{check.label}</span>
                {check.detail ? <span className="truncate text-muted-foreground/70">— {check.detail}</span> : null}
              </span>
              {!check.ok && check.fix ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[11px] cursor-pointer"
                  onClick={() => navigate(check.fix!)}
                >
                  Resolver <ChevronRight className="h-3 w-3" />
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
