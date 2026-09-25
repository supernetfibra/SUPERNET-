/**
 * Outbox: a única porta de escrita das notificações.
 *
 * A garantia de "não enviar duas vezes" NÃO está aqui em cima — está no banco
 * (`enqueue_notification` e `claim_notification_deliveries`, ver migration 003).
 * Este módulo só chama essas funções e traduz linhas para tipos do domínio. Isso é
 * deliberado: verificação de duplicidade no código da aplicação corre quando dois
 * dispatchers rodam ao mesmo tempo; constraint no banco, não.
 *
 * Toda dependência entra por injeção (`SupabaseLike`), o que mantém o módulo
 * typecheckável fora do Deno — como `sources.ts`.
 */

import type { Channel } from "./model.ts";

/**
 * Cliente Supabase em forma estrutural mínima. Tipar como `SupabaseClient`
 * exigiria importar de `esm.sh` e quebraria o `tsc` deste arquivo fora do Deno.
 */
export interface SupabaseLike {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): any;
}

export type DeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped"
  | "canceled";

export interface EnqueueInput {
  eventKey: string;
  /** Chave de idempotência do evento, ex.: `billing:1234:due_day`. */
  dedupeKey: string;
  customerId: string | null;
  cpf: string | null;
  /** Payload semântico dos templates (chaves com `__` são metadados). */
  payload: Record<string, unknown>;
  priority: "transactional" | "marketing";
  channel: Channel;
  target: string;
  rendered: { title?: string; body: string; url?: string } | null;
  scheduledFor: number;
}

export interface EnqueueResult {
  eventId: string | null;
  deliveryId: string | null;
  /** `false` = já existia (dedupe), nada foi criado. */
  created: boolean;
}

export interface ClaimedDelivery {
  id: string;
  eventId: string;
  channel: Channel;
  customerId: string | null;
  cpf: string | null;
  target: string;
  status: DeliveryStatus;
  attempts: number;
  scheduledFor: number;
  createdAt: number;
}

/**
 * Resultado da reserva de vaga na cota diária de novas conversas.
 *
 * `error` é preenchido quando a função do banco não pôde ser consultada (migration
 * 005 pendente). Nesse caso `allowed` é `true` — falhar fechado pararia TODOS os
 * envios por causa de uma migration ausente; falhar aberto mantém o comportamento
 * anterior, e o dispatcher **declara** no resumo que a cota não foi aplicada.
 */
export interface NewChatSlot {
  allowed: boolean;
  isNewChat: boolean;
  usedToday: number;
  cap: number;
  error?: string;
}

export interface OutboxEvent {
  id: string;
  eventKey: string;
  customerId: string | null;
  cpf: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
  priority: string;
}

export interface DeliveryRow {
  id: string;
  eventId: string;
  channel: string;
  customerId: string | null;
  cpf: string | null;
  target: string;
  rendered: Record<string, unknown> | null;
  status: DeliveryStatus;
  attempts: number;
  scheduledFor: number;
  providerId: string | null;
  errorKey: string | null;
  errorMessage: string | null;
  sentAt: number | null;
  statusAt: number | null;
  createdAt: number;
}

function toClaimed(row: Record<string, unknown>): ClaimedDelivery {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    channel: String(row.channel) as Channel,
    customerId: row.customer_id === null || row.customer_id === undefined ? null : String(row.customer_id),
    cpf: row.cpf === null || row.cpf === undefined ? null : String(row.cpf),
    target: String(row.target),
    status: String(row.status) as DeliveryStatus,
    attempts: Number(row.attempts ?? 0),
    scheduledFor: Number(row.scheduled_for ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

function toDeliveryRow(row: Record<string, unknown>): DeliveryRow {
  const claimed = toClaimed(row);
  return {
    ...claimed,
    rendered: (row.rendered ?? null) as Record<string, unknown> | null,
    providerId: row.provider_id === null || row.provider_id === undefined ? null : String(row.provider_id),
    errorKey: row.error_key === null || row.error_key === undefined ? null : String(row.error_key),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : Number(row.sent_at),
    statusAt: row.status_at === null || row.status_at === undefined ? null : Number(row.status_at),
  };
}

export interface OutboxApi {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  claim(input: { limit: number; channel?: Channel; now?: number; ids?: string[] }): Promise<ClaimedDelivery[]>;
  /**
   * Devolve a entrega para a fila **desfazendo** o incremento de `attempts` do
   * claim. Usado quando nada foi tentado (cota, time-lock): contar isso como
   * tentativa faria um cliente barrado pela cota esgotar as tentativas sem falha.
   */
  release(input: { deliveryId: string; scheduledFor: number; reason: string }): Promise<void>;
  eventsByIds(ids: string[]): Promise<Map<string, OutboxEvent>>;
  markSent(deliveryId: string, providerId: string | null): Promise<void>;
  markFailed(input: {
    deliveryId: string;
    errorKey: string | null;
    errorMessage: string | null;
    /** Se informado, a entrega volta para a fila nesse instante. */
    retryAt?: number | null;
    permanent?: boolean;
  }): Promise<void>;
  markSkipped(deliveryId: string, reason: string): Promise<void>;
  markStatusByProviderId(input: { providerId: string; status: DeliveryStatus; event?: string }): Promise<number>;
  get(deliveryId: string): Promise<DeliveryRow | null>;
  findEventByDedupeKey(dedupeKey: string): Promise<{ id: string } | null>;
  /**
   * Busca a entrega existente de um evento. É o que permite responder
   * "já enviado em <data>" quando o enfileiramento idempotente não cria nada.
   */
  findDelivery(input: { eventId: string; channel: Channel; target: string }): Promise<DeliveryRow | null>;
  updateContactOutcome(input: { customerId: string | null; target: string; error: string | null }): Promise<void>;
  /** Envios já registrados para o cliente desde `since` (cota por cliente). */
  countRecentForCustomer(input: { customerId: string; channel: Channel; since: number }): Promise<number>;
  /**
   * Reserva uma vaga na cota diária de NOVAS CONVERSAS do canal, de forma atômica
   * (`reserve_new_chat_slot`, migration 005). Chamada imediatamente antes de enviar;
   * `allowed: false` significa que a entrega deve voltar para a fila.
   *
   * `cap: 0` = sem teto (mesma leitura do simulador): registra se é conversa nova
   * para a contagem do dia, sem bloquear.
   */
  reserveNewChatSlot(input: {
    deliveryId: string;
    channel: Channel;
    cap: number;
    /** Início do dia civil local, em ms (mesma definição de dia do simulador). */
    dayStart: number;
  }): Promise<NewChatSlot>;
  list(input: { limit: number; status?: DeliveryStatus | "all"; customerId?: string }): Promise<DeliveryRow[]>;
  stats(input: { since: number }): Promise<Record<string, number>>;
}

export function createOutbox(db: () => SupabaseLike): OutboxApi {
  return {
    async enqueue(input) {
      const { data, error } = await db().rpc("enqueue_notification", {
        p_event_key: input.eventKey,
        p_dedupe_key: input.dedupeKey,
        p_customer_id: input.customerId,
        p_cpf: input.cpf,
        p_payload: input.payload,
        p_priority: input.priority,
        p_channel: input.channel,
        p_target: input.target,
        p_rendered: input.rendered,
        p_scheduled_for: input.scheduledFor,
      });
      if (error) throw new Error(`enqueue_notification falhou: ${error.message ?? error}`);

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) {
        // Sem linha de retorno: tratamos como "já existia" em vez de reenviar.
        return { eventId: null, deliveryId: null, created: false };
      }
      return {
        eventId: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
        deliveryId: row.delivery_id === null || row.delivery_id === undefined ? null : String(row.delivery_id),
        created: row.created === true,
      };
    },

    async claim({ limit, channel, now, ids }) {
      const { data, error } = await db().rpc("claim_notification_deliveries", {
        p_limit: limit,
        p_channel: channel ?? null,
        p_now: now ?? null,
        p_ids: ids && ids.length ? ids : null,
      });
      if (error) throw new Error(`claim_notification_deliveries falhou: ${error.message ?? error}`);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row: Record<string, unknown>) => toClaimed(row));
    },

    async release({ deliveryId, scheduledFor, reason }) {
      const { error } = await db().rpc("release_notification_delivery", {
        p_id: deliveryId,
        p_scheduled_for: scheduledFor,
        p_reason: reason,
      });
      if (error) throw new Error(`release_notification_delivery falhou: ${error.message ?? error}`);
    },

    async eventsByIds(ids) {
      const out = new Map<string, OutboxEvent>();
      if (!ids.length) return out;
      const { data, error } = await db().from("notification_events").select("*").in("id", ids);
      if (error) throw new Error(`leitura de notification_events falhou: ${error.message ?? error}`);
      for (const raw of (data ?? []) as Record<string, unknown>[]) {
        const row = raw as Record<string, unknown>;
        out.set(String(row.id), {
          id: String(row.id),
          eventKey: String(row.event_key),
          customerId: row.customer_id === null || row.customer_id === undefined ? null : String(row.customer_id),
          cpf: row.cpf === null || row.cpf === undefined ? null : String(row.cpf),
          dedupeKey: String(row.dedupe_key),
          payload: (row.payload ?? {}) as Record<string, unknown>,
          priority: String(row.priority ?? "marketing"),
        });
      }
      return out;
    },

    async markSent(deliveryId, providerId) {
      const now = Date.now();
      const { error } = await db()
        .from("notification_deliveries")
        .update({
          status: "sent",
          provider_id: providerId,
          sent_at: now,
          status_at: now,
          error_key: null,
          error_message: null,
        })
        .eq("id", deliveryId);
      if (error) throw new Error(`markSent falhou: ${error.message ?? error}`);
    },

    async markFailed({ deliveryId, errorKey, errorMessage, retryAt, permanent }) {
      const now = Date.now();
      const patch: Record<string, unknown> = {
        status: retryAt ? "queued" : "failed",
        error_key: errorKey,
        error_message: errorMessage,
        status_at: now,
      };
      if (retryAt) patch.scheduled_for = retryAt;
      if (permanent) patch.status = "failed";

      const { error } = await db().from("notification_deliveries").update(patch).eq("id", deliveryId);
      if (error) throw new Error(`markFailed falhou: ${error.message ?? error}`);
    },

    async markSkipped(deliveryId, reason) {
      const { error } = await db()
        .from("notification_deliveries")
        .update({ status: "skipped", error_message: reason, status_at: Date.now() })
        .eq("id", deliveryId);
      if (error) throw new Error(`markSkipped falhou: ${error.message ?? error}`);
    },

    async get(deliveryId) {
      const { data, error } = await db().from("notification_deliveries").select("*").eq("id", deliveryId).maybeSingle();
      if (error) throw new Error(`leitura da entrega falhou: ${error.message ?? error}`);
      return data ? toDeliveryRow(data as Record<string, unknown>) : null;
    },

    async findEventByDedupeKey(dedupeKey) {
      const { data, error } = await db()
        .from("notification_events")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (error || !data) return null;
      return { id: String((data as Record<string, unknown>).id) };
    },

    async findDelivery({ eventId, channel, target }) {
      const { data, error } = await db()
        .from("notification_deliveries")
        .select("*")
        .eq("event_id", eventId)
        .eq("channel", channel)
        .eq("target", target)
        .maybeSingle();
      if (error) return null;
      return data ? toDeliveryRow(data as Record<string, unknown>) : null;
    },

    async markStatusByProviderId({ providerId, status, event }) {
      const { data, error } = await db()
        .from("notification_deliveries")
        .update({ status, status_at: Date.now(), error_message: event ?? null })
        .eq("provider_id", providerId)
        .select("id");
      if (error) throw new Error(`markStatusByProviderId falhou: ${error.message ?? error}`);
      return Array.isArray(data) ? data.length : 0;
    },

    async updateContactOutcome({ customerId, target, error }) {
      const patch: Record<string, unknown> = { updated_at: Date.now() };
      if (error) {
        patch.last_error = error;
        patch.last_error_at = Date.now();
      } else {
        patch.last_error = null;
        patch.last_error_at = null;
      }
      let query = db().from("whatsapp_contacts").update(patch);
      query = customerId ? query.eq("customer_id", customerId) : query.eq("phone_e164", target);
      await query;
    },

    async countRecentForCustomer({ customerId, channel, since }) {
      const { count, error } = await db()
        .from("notification_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("channel", channel)
        .gte("created_at", since)
        .in("status", ["sent", "delivered", "read", "sending"]);
      if (error) return 0;
      return Number(count ?? 0);
    },

    async reserveNewChatSlot({ deliveryId, channel, cap, dayStart }) {
      // Fail-open com erro declarado: uma migration pendente não pode parar a fila
      // inteira, mas também não pode virar divergência silenciosa (o resumo do cron
      // carrega `newChats.error`).
      const fallback = (error: string): NewChatSlot => ({ allowed: true, isNewChat: false, usedToday: 0, cap, error });
      try {
        const { data, error } = await db().rpc("reserve_new_chat_slot", {
          p_delivery_id: deliveryId,
          p_channel: channel,
          p_cap: cap,
          p_day_start: dayStart,
        });
        if (error) return fallback(String(error.message ?? error));

        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
        if (!row) return fallback("reserve_new_chat_slot não devolveu linha");

        return {
          allowed: row.allowed !== false,
          isNewChat: row.is_new_chat === true,
          usedToday: Number(row.used_today ?? 0),
          cap: Number(row.cap ?? cap),
        };
      } catch (error) {
        return fallback(error instanceof Error ? error.message : String(error));
      }
    },

    async list({ limit, status, customerId }) {
      let query = db()
        .from("notification_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status && status !== "all") query = query.eq("status", status);
      if (customerId) query = query.eq("customer_id", customerId);
      const { data, error } = await query;
      if (error) throw new Error(`listagem de entregas falhou: ${error.message ?? error}`);
      return ((data ?? []) as Record<string, unknown>[]).map(toDeliveryRow);
    },

    async stats({ since }) {
      const { data, error } = await db()
        .from("notification_deliveries")
        .select("channel, status")
        .gte("created_at", since)
        .limit(5000);
      if (error) return {};
      const out: Record<string, number> = {};
      for (const row of ((data ?? []) as Record<string, unknown>[])) {
        const key = `${String(row.channel)}:${String(row.status)}`;
        out[key] = (out[key] ?? 0) + 1;
        out[String(row.status)] = (out[String(row.status)] ?? 0) + 1;
      }
      return out;
    },
  };
}
