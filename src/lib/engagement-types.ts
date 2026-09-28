import type { FunnelDeliveryRow, FunnelClickRow, FunnelWeek } from "../../supabase/functions/api/notify/engagement.ts";

export type { FunnelDeliveryRow, FunnelClickRow, FunnelWeek };

/**
 * Ponte de types entre o frontend (Vite) e o módulo puro de agregação do funil
 * (`supabase/functions/api/notify/engagement.ts`). O arquivo original está fora
 * do `tsconfig.app.json` (que cobre só `src/`), mas é importável — o tsconfig do
 * app aceita arquivos fora da raiz quando referenciados; este reexport é o ponto
 * único que o painel importa, sem duplicar a interface e sem arriscar divergência
 * entre o que o backend devolve e o que a UI espera.
 *
 * Se o backend mudar a forma do payload, este arquivo quebra no typecheck do
 * painel — exatamente o desejado.
 */
export interface FunnelWeekView {
  weekStart: string;
  weekEnd: string;
  label: string;
  sent: number;
  delivered: number;
  read: number;
  pixClicks: number;
  failed: number;
}

export interface FunnelTotalsView {
  sent: number;
  delivered: number;
  read: number;
  pixClicks: number;
  failed: number;
}
