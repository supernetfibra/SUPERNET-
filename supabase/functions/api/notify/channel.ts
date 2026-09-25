/**
 * Contratos de canal (ver NOTIFICACOES-HUB.md §3).
 *
 * O dispatcher fala **só** por esta interface. Hoje o único adapter registrado é o
 * de WhatsApp; quando o push migrar para o hub, ele entra como mais um adapter e o
 * dispatcher não muda. Foi para isso que a interface existe antes do push existir.
 *
 * O resultado de entrega carrega três desfechos que não são "sucesso/falha":
 *   retryAt    → pode tentar de novo mais tarde (429, time-lock)
 *   permanent  → destino morto (410 no push, número inválido no WhatsApp)
 *   uncertain  → timeout: o envio PODE ter acontecido. Repetir cego aqui é o que
 *                gera mensagem duplicada para o cliente (doc da UazAPI, §"Evite
 *                duplicações").
 */

import type { Channel } from "./model.ts";

export interface Rendered {
  title?: string;
  body: string;
  url?: string;
}

export interface DeliveryContext {
  eventId: string;
  eventKey: string;
  priority: string;
  /** `true` quando o disparo partiu de um humano (botão "enviar agora"). */
  manual: boolean;
  now: number;
}

export interface ChannelDeliveryResult {
  ok: boolean;
  providerId?: string | null;
  errorKey?: string | null;
  errorMessage?: string | null;
  permanent?: boolean;
  retryAt?: number | null;
  uncertain?: boolean;
}

export interface ChannelReadiness {
  ok: boolean;
  reason?: string;
  retryAt?: number | null;
}

export interface ChannelAdapter {
  key: Channel;
  /** O canal está operante agora? (VAPID configurado / instância conectada) */
  ready(): Promise<ChannelReadiness>;
  deliver(target: string, rendered: Rendered, ctx: DeliveryContext): Promise<ChannelDeliveryResult>;
  onPermanentFailure?(target: string, result: ChannelDeliveryResult): Promise<void>;
  /** Provedor pediu pausa global (time-lock): registra e interrompe o lote. */
  onGlobalPause?(until: number, reason: string): Promise<void>;
}

export interface ChannelRegistry {
  get(key: Channel): ChannelAdapter | null;
  keys(): Channel[];
}

export function createChannelRegistry(adapters: ChannelAdapter[]): ChannelRegistry {
  const map = new Map(adapters.map((adapter) => [adapter.key, adapter]));
  return {
    get: (key) => map.get(key) ?? null,
    keys: () => [...map.keys()],
  };
}
