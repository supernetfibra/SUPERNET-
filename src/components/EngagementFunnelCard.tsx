/**
 * EngagementFunnelCard — funil de engajamento + cliques nos botões (Fase 4.6).
 *
 * Movido de AdminConnections para o domínio de Mensagens (a auditoria apontava
 * que o funil enviado→entregue→lido→Pix é dado de operação de mensagem, não de
 * credenciais). Nenhum redesign: os blocos JSX e os endpoints são exatamente
 * os mesmos que viviam em Conexões:
 *   - GET /api/admin/whatsapp/button-stats      (cliques, 30 dias)
 *   - GET /api/admin/whatsapp/engagement-funnel (funil por semana, 8 semanas)
 * Falha silenciosa: se os endpoints não responderem, as seções ficam ocultas.
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adminFetch } from "@/lib/api-config";
import type { FunnelTotalsView, FunnelWeekView } from "@/lib/engagement-types";

interface ButtonStat {
  label: string;
  clicks: number;
  uniquePhones: number;
  matched: number;
  lastClickAt: number | null;
}

export function EngagementFunnelCard() {
  /** Uso real dos botões (cliques reportados pelo webhook, 30 dias). */
  const [buttonStats, setButtonStats] = useState<ButtonStat[] | null>(null);
  /** Funil de engajamento semanal (enviado → entregue → lido → Pix). */
  const [funnel, setFunnel] = useState<{
    weeks: FunnelWeekView[];
    totals: FunnelTotalsView;
    pending?: string;
  } | null>(null);

  useEffect(() => {
    // Métricas de cliques nos botões (migration 007). Falha silenciosa: se a view
    // ainda não existe, o endpoint devolve vazio e a seção simplesmente não aparece.
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/whatsapp/button-stats");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data?.stats)) setButtonStats(data.stats);
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
          setFunnel({ weeks: data.weeks, totals: data.totals, pending: data.pending });
        }
      } catch {
        // seção fica oculta
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!buttonStats && !funnel) return null;

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Funil de engajamento</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          O que aconteceu com as mensagens enviadas — entregas, leituras e cliques reportados pelo WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Uso real dos botões de ação (webhook, últimos 30 dias) */}
        {buttonStats && buttonStats.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              Cliques nos botões (30 dias)
            </div>
            <div className="grid gap-1.5">
              {buttonStats.map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs"
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
                        className="text-xs"
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
        {funnel ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                Funil de engajamento (por semana)
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>enviados</span>
                <span>· entregues</span>
                <span>· lidos</span>
                <span>· Pix</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              {funnel.weeks.map((week) => {
                const max = Math.max(week.sent, 1);
                return (
                  <div key={week.weekStart} className="rounded-sm border border-border px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">{week.label}</span>
                      {week.failed > 0 ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400" title="Falhas reportadas pelo WhatsApp na semana">
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
                          <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                total (8 sem.):{" "}
                <span className="font-mono text-foreground">{funnel.totals.sent}</span> enviados ·{" "}
                <span className="font-mono text-foreground">{funnel.totals.delivered}</span> entregues ·{" "}
                <span className="font-mono text-foreground">{funnel.totals.read}</span> lidos ·{" "}
                <span className="font-mono text-foreground">{funnel.totals.pixClicks}</span> clicaram no Pix
              </span>
              {funnel.pending ? <span className="text-amber-600 dark:text-amber-400">({funnel.pending})</span> : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
