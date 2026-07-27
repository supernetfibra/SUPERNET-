/**
 * Diagnostics — Internal health-check / status reporter.
 *
 * Collects [BILLING] diagnostic events from BillingProvider into a
 * structured store. Exposes `window.__diagnostics()` for support
 * personnel to type in the browser console and get an instant summary
 * of what the app has been doing.
 *
 * Usage (in browser DevTools console):
 *   __diagnostics()         → full formatted summary
 *   __diagnostics.raw       → raw event array
 *   __diagnostics.clear()   → reset the store
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DiagEventType =
  | "api_few_billings"       // API returned < 2 invoices
  | "api_all_paid"           // API returned only paid invoices
  | "api_all_paid_no_dates"  // same, but without valid due dates
  | "cache_hit"              // fallback to localStorage cache succeeded
  | "cache_miss"             // fallback to localStorage cache failed
  | "api_error"              // API returned a non-ok status
  | "fetch_ok"               // normal successful fetch (logged for tracking)
  | "api_success";           // API returned ok (used internally)

interface DiagEventBase {
  type: DiagEventType;
  timestamp: number;
  customer: string; // truncated customer ID
}

interface FewBillingsEvent extends DiagEventBase {
  type: "api_few_billings";
  count: number;
}

interface AllPaidEvent extends DiagEventBase {
  type: "api_all_paid";
  count: number;
  mostRecentDays: number;
}

interface AllPaidNoDatesEvent extends DiagEventBase {
  type: "api_all_paid_no_dates";
  count: number;
}

interface CacheHitEvent extends DiagEventBase {
  type: "cache_hit";
  count: number;
  ageMinutes: number;
}

interface CacheMissEvent extends DiagEventBase {
  type: "cache_miss";
  error: string;
}

interface ApiErrorEvent extends DiagEventBase {
  type: "api_error";
  status: number;
}

interface FetchOkEvent extends DiagEventBase {
  type: "fetch_ok";
  count: number;
}

export type DiagEvent =
  | FewBillingsEvent
  | AllPaidEvent
  | AllPaidNoDatesEvent
  | CacheHitEvent
  | CacheMissEvent
  | ApiErrorEvent
  | FetchOkEvent;

// ---------------------------------------------------------------------------
// Store (singleton)
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;

class DiagnosticsStore {
  private events: DiagEvent[] = [];

  push(event: DiagEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  get all(): readonly DiagEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  /** Produce a human-readable summary string */
  summary(): string {
    const e = this.events;
    if (e.length === 0) return "Nenhum evento de diagnóstico registrado.";

    const lines: string[] = [];
    lines.push(`╔══════════════════════════════════════════╗`);
    lines.push(`║     Diagnóstico do Portal do Cliente     ║`);
    lines.push(`╚══════════════════════════════════════════╝`);
    lines.push(`  Total de eventos: ${e.length}`);
    lines.push(`  Período: ${this.formatAge(e[0].timestamp)} — ${this.formatAge(e[e.length - 1].timestamp)}`);
    lines.push("");

    // Count by type
    const byType = new Map<DiagEventType, number>();
    for (const ev of e) {
      byType.set(ev.type, (byType.get(ev.type) || 0) + 1);
    }
    lines.push(`  ── Eventos por tipo ──`);
    for (const [type, count] of byType) {
      lines.push(`    ${type.padEnd(24)} ${count}`);
    }
    lines.push("");

    // Last few events
    const recent = e.slice(-5);
    lines.push(`  ── Últimos ${recent.length} eventos ──`);
    for (const ev of recent) {
      const time = this.formatTime(ev.timestamp);
      switch (ev.type) {
        case "api_few_billings":
          lines.push(`    [${time}] ⚠ ${ev.count} fatura(s) retornada(s)`);
          break;
        case "api_all_paid":
          lines.push(`    [${time}] ⚠ Todas pagas (${ev.count}), mais recente há ${ev.mostRecentDays}d`);
          break;
        case "api_all_paid_no_dates":
          lines.push(`    [${time}] ⚠ Todas pagas (${ev.count}), sem datas`);
          break;
        case "cache_hit":
          lines.push(`    [${time}] 📦 Cache: ${ev.count} faturas, ${ev.ageMinutes}min`);
          break;
        case "cache_miss":
          lines.push(`    [${time}] ❌ Sem cache: ${ev.error}`);
          break;
        case "api_error":
          lines.push(`    [${time}] 🔴 API erro: status ${ev.status}`);
          break;
        case "fetch_ok":
          lines.push(`    [${time}] ✅ ${ev.count} faturas OK`);
          break;
      }
    }
    lines.push("");
    lines.push(`  Digite __diagnostics.raw para ver todos os eventos.`);
    lines.push(`  Digite __diagnostics.clear() para limpar.`);

    return lines.join("\n");
  }

  private formatAge(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) return "agora";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min atrás`;
    return `${Math.floor(diff / 3600000)}h atrás`;
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
}

// Singleton — all BillingProvider instances share the same store
const store = new DiagnosticsStore();
export default store;

// ---------------------------------------------------------------------------
// Global registration — call once from main.tsx
// ---------------------------------------------------------------------------

export function registerDiagnostics(): void {
  if (
    typeof window !== "undefined" &&
    typeof (window as any).__diagnostics === "undefined"
  ) {
    const fn = () => console.log(store.summary());
    (fn as any).raw = store.all;
    (fn as any).clear = () => store.clear();
    (window as any).__diagnostics = fn;

    console.log(
      "%c📊 Diagnóstico interno disponível. Digite __diagnostics() no console.",
      "color: #6b7280; font-size: 11px;",
    );
  }
}
