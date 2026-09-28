/**
 * Funil de engajamento do WhatsApp — enviado → entregue → lido → clicou no Pix.
 *
 * Agregação SEMANAL (segunda a domingo, no fuso do projeto) para o painel. Módulo
 * puro, sem I/O: o endpoint busca as linhas e injeta aqui, igual a `sources.ts` —
 * assim o funil roda no `check:notify` via Node sem banco.
 *
 * Duas decisões de semântica que importam:
 *
 *   1. A coorte da semana é `sent_at`: uma mensagem enviada na semana 18 e lida
 *      na 19 conta enviados, entregues e lidos na 18. Cada entrega contribui para
 *      UMA semana só, então a conversão por semana nunca passa de 100% e as
 *      semanas são comparáveis entre si. (Se cada etapa fosse bucketizada na sua
 *      própria semana, uma leitura atrasada inflaria a semana seguinte.)
 *
 *   2. "Enviados" inclui quem chegou a entregue/lido — é um funil cumulativo
 *      (entregue ⊇ lido), não um somatório de estados. Cliques no Pix contam por
 *      rótulo contendo "pix" (case-insensitive), o que cobre "Copiar código Pix"
 *      sem acoplar a agregação ao texto exato do template.
 */

import { addDays, DEFAULT_TZ_OFFSET_MINUTES } from "./model.ts";

export interface FunnelWeek {
  /** Segunda-feira da semana, data civil (YYYY-MM-DD). */
  weekStart: string;
  /** Domingo da semana, data civil (YYYY-MM-DD). */
  weekEnd: string;
  /** Rótulo curto pt-BR ("21–27 set", "28 set – 4 out"). */
  label: string;
  /** Envios que saíram na semana (inclui os que chegaram a entregue/lido). */
  sent: number;
  /** Confirmações de entrega reportadas pelo webhook. */
  delivered: number;
  /** Confirmações de leitura reportadas pelo webhook. */
  read: number;
  /** Cliques no botão do Pix copiável (migration 007). */
  pixClicks: number;
  /** Falhas reportadas na semana (contexto para "enviados" menor que o esperado). */
  failed: number;
}

/** Linha mínima de `notification_deliveries` para o funil (epoch ms). */
export interface FunnelDeliveryRow {
  status: string;
  sent_at: number | null;
  created_at: number;
}

/** Linha mínima de `whatsapp_button_clicks` (epoch ms). */
export interface FunnelClickRow {
  created_at: number;
  button_label: string | null;
}

const DAY_MS = 86_400_000;

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Data civil (YYYY-MM-DD) da SEGUNDA-FEIRA da semana de um instante, no fuso do
 * projeto. Mesma aritmética de `civilDayStartMs` (model.ts): desloca o instante
 * pelo offset do fuso, computa o dia civil em UTC puro e volta.
 */
export function weekStartOf(ms: number, tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES): string {
  const dayIndex = Math.floor((ms + tzOffsetMinutes * 60_000) / DAY_MS);
  const weekday = new Date(dayIndex * DAY_MS).getUTCDay(); // 0 = domingo
  const mondayIndex = dayIndex - ((weekday + 6) % 7);
  return new Date(mondayIndex * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Instante (ms) da meia-noite LOCAL do início de uma semana civil — o `>=`
 * da consulta que alimenta o funil. Inverso de `weekStartOf` para datas de
 * segunda-feira.
 */
export function weekStartToMs(weekStart: string, tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES): number {
  return Date.parse(`${weekStart}T00:00:00Z`) - tzOffsetMinutes * 60_000;
}

function shortDay(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return `${day} ${MONTHS_PT[month - 1]}`;
}

/** "21–27 set" (mesmo mês) · "28 set – 4 out" (troca de mês) · com ano na virada. */
export function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
  const sameYear = weekStart.slice(0, 4) === weekEnd.slice(0, 4);
  const dayOf = (isoDate: string): string => String(Number(isoDate.slice(8, 10)));
  if (sameMonth) return `${dayOf(weekStart)}–${shortDay(weekEnd)}`;
  const start = sameYear ? shortDay(weekStart) : `${shortDay(weekStart)} ${weekStart.slice(2, 4)}`;
  const end = sameYear ? shortDay(weekEnd) : `${shortDay(weekEnd)} ${weekEnd.slice(2, 4)}`;
  return `${start} – ${end}`;
}

/**
 * Esqueleto das últimas `weeks` semanas (mais antiga → semana corrente), com
 * contadores zerados. Sempre inclui a semana corrente: um funil que some na
 * segunda-feira de manhã parece bug, não semana vazia.
 */
export function buildFunnelWeeks(input: { now: number; weeks: number; tzOffsetMinutes?: number }): FunnelWeek[] {
  const tz = input.tzOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES;
  const currentStart = weekStartOf(input.now, tz);
  const out: FunnelWeek[] = [];
  for (let i = input.weeks - 1; i >= 0; i--) {
    const weekStart = addDays(currentStart, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    out.push({
      weekStart,
      weekEnd,
      label: formatWeekLabel(weekStart, weekEnd),
      sent: 0,
      delivered: 0,
      read: 0,
      pixClicks: 0,
      failed: 0,
    });
  }
  return out;
}

function isPixLabel(label: string | null): boolean {
  return !!label && label.toLowerCase().includes("pix");
}

/**
 * Soma as linhas no esqueleto de semanas. MUTA as semanas recebidas e devolve a
 * mesma lista — o endpoint monta o esqueleto e o usa direto na resposta.
 * Semanas fora da janela (linhas mais antigas que a primeira semana) são
 * ignoradas: a janela é definida pelo esqueleto, não pelas linhas.
 */
export function aggregateFunnel(input: {
  weeks: FunnelWeek[];
  deliveries: FunnelDeliveryRow[];
  clicks?: FunnelClickRow[];
  tzOffsetMinutes?: number;
}): FunnelWeek[] {
  const tz = input.tzOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES;
  const index = new Map(input.weeks.map((week) => [week.weekStart, week] as const));
  const bucketOf = (ms: number): FunnelWeek | undefined => index.get(weekStartOf(ms, tz));

  for (const row of input.deliveries) {
    // Falha é contexto (não entra no funil): bucketizada pelo instante em que a
    // tentativa existe (`created_at` — falha não tem `sent_at`).
    if (row.status === "failed") {
      const week = bucketOf(row.created_at);
      if (week) week.failed++;
      continue;
    }
    if (row.status !== "sent" && row.status !== "delivered" && row.status !== "read") continue;
    // Coorte por `sent_at` (ver docstring). `created_at` é só cinto de segurança
    // para linhas antigas sem marca de envio.
    const week = bucketOf(row.sent_at ?? row.created_at);
    if (!week) continue;
    week.sent++;
    if (row.status === "delivered" || row.status === "read") week.delivered++;
    if (row.status === "read") week.read++;
  }

  for (const row of input.clicks ?? []) {
    if (!isPixLabel(row.button_label)) continue;
    const week = bucketOf(row.created_at);
    if (week) week.pixClicks++;
  }

  return input.weeks;
}

/** Totais do período (para a linha "total" do painel). */
export function funnelTotals(weeks: FunnelWeek[]): {
  sent: number;
  delivered: number;
  read: number;
  pixClicks: number;
  failed: number;
} {
  return weeks.reduce(
    (acc, week) => ({
      sent: acc.sent + week.sent,
      delivered: acc.delivered + week.delivered,
      read: acc.read + week.read,
      pixClicks: acc.pixClicks + week.pixClicks,
      failed: acc.failed + week.failed,
    }),
    { sent: 0, delivered: 0, read: 0, pixClicks: 0, failed: 0 }
  );
}
