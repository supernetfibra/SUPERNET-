/**
 * SendFlowCard — o fluxo de envio como uma trilha numerada, com status ao vivo.
 *
 * Simplificação deliberada: o operador não precisa saber o que é UazAPI, outbox
 * ou capping — precisa saber "onde estou, o que falta, qual botão apertar".
 * Cada passo tem UMA ação primária (as avançadas continuam no card abaixo).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  FlaskConical,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  return fetch(withAdminToken(url), { ...init, credentials: "include" });
}

interface FlowStatus {
  credentials: { ok: boolean; origin: string };
  connected: { ok: boolean; state: string | null };
  enabled: { ok: boolean };
  rules: { ok: boolean; active: number | null; total: number | null };
  contacts: { ok: boolean; optIn: number | null };
  queue: { ready: number; scheduled: number; failed: number };
  window: { inWindow: boolean; start: number; end: number };
  pausedUntil: number | null;
  timeLock: number | null;
  sendGapSeconds: number | null;
  /** Timestamp do cliente capturado no load — comparações de pausa ficam puras no render. */
  nowAt: number;
}

type StepState = "ok" | "todo" | "warn";

export function SendFlowCard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/whatsapp/flow-status");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Erro no diagnóstico.");
      setStatus({ ...(data as FlowStatus), nowAt: Date.now() });
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      const res = await adminFetch("/api/cron/notify-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25, policy: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Falha ao disparar a fila.");
      const sent = Number(data?.summary?.sent ?? 0);
      const failed = Number(data?.summary?.failed ?? 0);
      toast.success(
        sent || failed
          ? `Envio concluído: ${sent} mensagem(ns) saíram${failed ? `, ${failed} falharam (veja a fila)` : ""}.`
          : "Nada a enviar agora — a fila está em dia."
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao disparar a fila.");
    } finally {
      setDispatching(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verificando o fluxo de envio…
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
          Não foi possível verificar o fluxo agora.
          <Button variant="outline" size="sm" className="h-8 text-xs cursor-pointer" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }

  const paused = status.pausedUntil ? Number(status.pausedUntil) > status.nowAt : false;
  const timeLocked = status.timeLock ? Number(status.timeLock) > status.nowAt : false;

  const steps: {
    n: number;
    title: string;
    detail: string;
    state: StepState;
    action?: { label: string; onClick: () => void; icon?: typeof Send };
  }[] = [
    {
      n: 1,
      title: "Conectar o WhatsApp",
      detail: status.credentials.ok
        ? status.connected.ok
          ? "Instância conectada e pronta para enviar."
          : `Instância ${status.connected.state ?? "desconhecida"} — reconecte pelo QR.`
        : "Informe a URL e o token da UazAPI nos campos abaixo.",
      state: status.credentials.ok && status.connected.ok ? "ok" : "todo",
      action:
        status.credentials.ok && !status.connected.ok
          ? undefined /* o QR fica no card principal, logo abaixo */
          : undefined,
    },
    {
      n: 2,
      title: "Ligar o canal",
      detail: status.enabled.ok
        ? "Canal ativo — a régua pode disparar."
        : "Ligue o interruptor \"Canal ativo\" abaixo para o envio começar.",
      state: status.enabled.ok ? "ok" : "todo",
    },
    {
      n: 3,
      title: "Escolher quem recebe",
      detail:
        (status.rules.active ?? 0) > 0
          ? `${status.rules.active} de ${status.rules.total} regras da régua ativas.`
          : "Nenhuma regra da régua ativa — ligue pelo menos uma em \"Régua de lembretes\".",
      state: (status.rules.active ?? 0) > 0 ? "ok" : "todo",
    },
    {
      n: 4,
      title: "Clientes alcançáveis",
      detail:
        (status.contacts.optIn ?? 0) > 0
          ? `${status.contacts.optIn} contatos com opt-in na lista de envio.`
          : "Nenhum contato com opt-in — use \"Importar contatos\" abaixo.",
      state: (status.contacts.optIn ?? 0) > 0 ? "ok" : "todo",
    },
    {
      n: 5,
      title: "Avisos na fila",
      detail: `${status.queue.ready} prontos para sair agora · ${status.queue.scheduled} agendados${
        status.queue.failed ? ` · ${status.queue.failed} falharam (reenviar na Fila)` : ""
      }`,
      state: status.queue.failed > 0 ? "warn" : status.queue.ready > 0 ? "todo" : "ok",
      action:
        status.queue.ready > 0 || status.queue.failed > 0
          ? {
              label: "Enviar agora",
              onClick: handleDispatch,
              icon: Send,
            }
          : undefined,
    },
  ];

  const blockers: string[] = [];
  if (timeLocked) blockers.push("WhatsApp impôs pausa (time-lock) — o canal retoma automaticamente quando liberar.");
  else if (paused) blockers.push(`Envio pausado até ${new Date(Number(status.pausedUntil)).toLocaleString("pt-BR")}.`);
  if (!status.window.inWindow && status.enabled.ok)
    blockers.push(`Fora da janela de envio (${status.window.start}h–${status.window.end}h) — a fila anda sozinha quando abrir.`);

  const doneCount = steps.filter((s) => s.state === "ok").length;

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium tracking-tight">Fluxo de envio</CardTitle>
          <span className="text-[10px] text-muted-foreground">
            {doneCount}/{steps.length} prontos
          </span>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          O caminho da mensagem, do WhatsApp até a fila — na ordem. Cada passo tem uma ação.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {steps.map((step) => (
          <div
            key={step.n}
            className="flex items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:border-border transition-colors"
          >
            <span className="mt-0.5 shrink-0">
              {step.state === "ok" ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                </span>
              ) : step.state === "warn" ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <CircleAlert className="h-3 w-3" />
                </span>
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {step.n}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{step.title}</p>
              <p className="text-[11px] text-muted-foreground">{step.detail}</p>
            </div>
            {step.action ? (
              <Button
                size="sm"
                className="h-8 text-xs cursor-pointer shrink-0"
                onClick={step.action.onClick}
                disabled={dispatching}
              >
                {dispatching ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : step.action.icon ? (
                  <step.action.icon className="h-3.5 w-3.5 mr-1.5" />
                ) : null}
                {step.action.label}
              </Button>
            ) : null}
          </div>
        ))}

        {blockers.length ? (
          <div className="mt-3 flex items-start gap-2 rounded-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5">
              {blockers.map((b) => (
                <p key={b} className="text-[11px] text-amber-700 dark:text-amber-400">
                  {b}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs cursor-pointer text-muted-foreground"
            onClick={() => navigate("/admin/simulator")}
          >
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            Prever o que sairia
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {status.sendGapSeconds
              ? `Ritmo atual: 1 mensagem a cada ${status.sendGapSeconds}s.`
              : "Ritmo atual: padrão humano."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
