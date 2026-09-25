-- =============================================================================
-- 005 — Cota diária de NOVAS CONVERSAS
-- =============================================================================
-- Fecha a última divergência entre a simulação e o envio.
--
-- `routing.ts` sempre soube responder "quantas conversas novas começam hoje?"
-- (`newChatCapPerDay`, com `hasExistingConversation` decidindo quem consome). A
-- produção não: o dispatcher contava apenas a cota POR CLIENTE e deixava o teto
-- global de novas conversas para o próprio WhatsApp — que responde a excesso de
-- conversas novas com **time-lock** (erro 463, restrição do número), não com erro
-- de mensagem. Ou seja: o estouro aparecia como bloqueio do canal, depois de já
-- ter acontecido.
--
-- A decisão mora aqui, no banco, pela mesma razão que a idempotência mora (ver
-- migration 003): reserva de cota é *check-and-set*. Dois crons sobrepostos — ou o
-- botão do painel rodando junto do cron — leriam o mesmo `used` e os dois passariam
-- do teto. `pg_advisory_xact_lock` serializa a contagem por canal.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

-- =============================================================================
-- 1. A MARCA DA CONVERSA NOVA
-- =============================================================================
-- Gravada no momento do ENVIO, não no enfileiramento: se aquele destino já tem
-- envio anterior bem-sucedido, a entrega é uma continuação de conversa e não
-- consome cota. É a mesma condição que o simulador usa (`hasExistingConversation`).

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS new_chat BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN notification_deliveries.new_chat IS
  'A entrega abriu uma conversa nova (nenhum envio anterior bem-sucedido para este destino). Consome a cota diária de novas conversas.';

-- Índice parcial: a contagem da cota só olha as linhas que consomem vaga.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_new_chat
  ON notification_deliveries (channel, status_at)
  WHERE new_chat;

-- =============================================================================
-- 2. CLAIM PASSA A MARCAR `status_at`
-- =============================================================================
-- A contagem da cota usa `COALESCE(sent_at, status_at)`. Sem `status_at` no claim,
-- uma entrega reservada e ainda não enviada não teria como ser situada no dia — e a
-- reserva de hoje escaparia da contagem de amanhã. Mesma função da migration 003,
-- com essa única alteração.

CREATE OR REPLACE FUNCTION claim_notification_deliveries(
  p_limit INT,
  p_channel TEXT DEFAULT NULL,
  p_now BIGINT DEFAULT NULL,
  p_ids UUID[] DEFAULT NULL
)
RETURNS SETOF notification_deliveries AS $$
  UPDATE notification_deliveries d
     SET status = 'sending',
         attempts = d.attempts + 1,
         status_at = COALESCE(p_now, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
   WHERE d.id IN (
     SELECT id
       FROM notification_deliveries
      WHERE status = 'queued'
        AND scheduled_for <= COALESCE(p_now, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
        AND (p_channel IS NULL OR channel = p_channel)
        AND (p_ids IS NULL OR id = ANY(p_ids))
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 1)
   )
  RETURNING *;
$$ LANGUAGE sql;

-- =============================================================================
-- 3. RESERVA DE VAGA PARA NOVA CONVERSA
-- =============================================================================
-- Chamada pelo dispatcher imediatamente antes de enviar, com a entrega já
-- reservada (`sending`). Devolve se o envio pode acontecer agora:
--
--   allowed = FALSE  → a cota do dia acabou; a entrega é devolvida para a fila
--                      (`release_notification_delivery`, sem consumir tentativa)
--                      e o dia seguinte a pega.
--   is_new_chat      → esta entrega abre conversa nova (aparece no resumo do cron).
--   used_today       → quantas novas conversas o dia já tem, incluindo esta.
--
-- Por que a reserva NÃO acontece dentro do `claim`: o claim devolveria um lote sem as
-- entregas barradas, e uma fila com muitas conversas novas à frente de lembretes
-- antigos deixaria estes últimos sem serem reservados (o `LIMIT` do claim corta antes
-- de a fila chegar neles). Pior: o admin não veria nada — as entregas sumiriam do lote
-- sem motivo declarado. Separando, cada entrega barrada passa por `release()` com o
-- motivo gravado em `error_message`, o resumo do cron conta quantas ficaram para
-- depois (`heldByCap`) e o número não mente sobre o barrado.
--
-- Três decisões que valem dinheiro:
--   - **cota 0 significa "sem teto"** (igual ao simulador): o simulador só aplica a
--     cota quando `newChatCapPerDay > 0`, e um 0 aqui não pode virar bloqueio total.
--   - **a reserva é idempotente por entrega**: um reenvio do MESMO aviso (falha
--     transitória na véspera) não consome uma segunda vaga no mesmo dia.
--   - **conversa existente não consome vaga**: só a primeira mensagem para um
--     destino conta, exatamente como no relatório do simulador.

CREATE OR REPLACE FUNCTION reserve_new_chat_slot(
  p_delivery_id UUID,
  p_channel TEXT,
  p_cap INT,
  p_day_start BIGINT
)
RETURNS TABLE (allowed BOOLEAN, is_new_chat BOOLEAN, used_today INT, cap INT) AS $$
DECLARE
  v_already BOOLEAN;
  v_is_new BOOLEAN;
  v_used INT;
  v_cap INT := GREATEST(COALESCE(p_cap, 0), 0);
BEGIN
  SELECT d.new_chat,
         NOT EXISTS (
           SELECT 1
             FROM notification_deliveries p
            WHERE p.channel = d.channel
              AND p.target = d.target
              AND p.id <> d.id
              AND p.status IN ('sent', 'delivered', 'read')
         )
    INTO v_already, v_is_new
    FROM notification_deliveries d
   WHERE d.id = p_delivery_id;

  -- Entrega inexistente: não há o que reservar nem motivo para barrar.
  IF NOT FOUND THEN
    RETURN QUERY SELECT TRUE, FALSE, 0, v_cap;
    RETURN;
  END IF;

  SELECT COUNT(*)::INT
    INTO v_used
    FROM notification_deliveries
   WHERE channel = p_channel
     AND new_chat
     AND status IN ('sending', 'sent', 'delivered', 'read')
     AND COALESCE(sent_at, status_at) >= p_day_start;

  -- Já reservada (reenvio do mesmo aviso): não consome uma segunda vaga.
  IF v_already THEN
    RETURN QUERY SELECT TRUE, TRUE, v_used, v_cap;
    RETURN;
  END IF;

  -- Conversa já aberta com este destino: não é conversa nova.
  IF NOT v_is_new THEN
    RETURN QUERY SELECT TRUE, FALSE, v_used, v_cap;
    RETURN;
  END IF;

  -- A partir daqui é uma conversa nova de verdade: serializa a decisão por canal.
  PERFORM pg_advisory_xact_lock(hashtext('notify:new_chat:' || COALESCE(p_channel, '*')));

  -- Recontagem SOB o lock: é este número que decide.
  SELECT COUNT(*)::INT
    INTO v_used
    FROM notification_deliveries
   WHERE channel = p_channel
     AND new_chat
     AND status IN ('sending', 'sent', 'delivered', 'read')
     AND COALESCE(sent_at, status_at) >= p_day_start;

  IF v_cap > 0 AND v_used >= v_cap THEN
    RETURN QUERY SELECT FALSE, TRUE, v_used, v_cap;
    RETURN;
  END IF;

  UPDATE notification_deliveries SET new_chat = TRUE WHERE id = p_delivery_id;
  RETURN QUERY SELECT TRUE, TRUE, v_used + 1, v_cap;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. RE-APLICAÇÃO DE `enqueue_notification` (corpo IDÊNTICO ao da migration 003)
-- =============================================================================
-- Mesmo motivo do claim acima: o Supabase não re-executa uma migration já aplicada.
-- A 003 criava esta função com `ON CONFLICT (event_id, channel, target)` — e
-- `event_id` é também parâmetro de saída da função, o que faz o plpgsql recusar a
-- consulta em tempo de execução ("column reference is ambiguous", SQLSTATE 42702).
-- Nada disso aparece ao aplicar a migration: a função é criada com sucesso e falha na
-- PRIMEIRA cobrança enfileirada.
--
-- Descoberto por `scripts/check-notifications-sql.mjs` (Postgres de verdade), não por
-- revisão. Quem já tinha aplicado a 003 recebe a correção aqui; quem aplicar as duas
-- de uma vez acaba com a mesma definição, porque é literalmente o mesmo texto.
-- `#variable_conflict use_column` resolve a ambiguidade sem renomear as colunas de
-- retorno (que são o contrato de `outbox.ts`: `event_id`, `delivery_id`, `created`).

CREATE OR REPLACE FUNCTION enqueue_notification(
  p_event_key TEXT,
  p_dedupe_key TEXT,
  p_customer_id TEXT,
  p_cpf TEXT,
  p_payload JSONB,
  p_priority TEXT,
  p_channel TEXT,
  p_target TEXT,
  p_rendered JSONB,
  p_scheduled_for BIGINT
)
RETURNS TABLE (event_id UUID, delivery_id UUID, created BOOLEAN) AS $$
-- `use_column`: `event_id` é parâmetro de saída E coluna de notification_deliveries.
-- Sem esta diretiva o `ON CONFLICT` abaixo falha com "column reference is ambiguous".
#variable_conflict use_column
DECLARE
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_event_id UUID;
  v_delivery_id UUID;
BEGIN
  INSERT INTO notification_events (event_key, dedupe_key, customer_id, cpf, payload, priority, created_at)
  VALUES (p_event_key, p_dedupe_key, p_customer_id, p_cpf, COALESCE(p_payload, '{}'::JSONB), p_priority, v_now)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT e.id INTO v_event_id FROM notification_events e WHERE e.dedupe_key = p_dedupe_key;
    RETURN QUERY SELECT v_event_id, NULL::UUID, FALSE;
    RETURN;
  END IF;

  INSERT INTO notification_deliveries (
    event_id, channel, customer_id, cpf, target, rendered, status, scheduled_for, created_at
  )
  VALUES (
    v_event_id, p_channel, p_customer_id, p_cpf, p_target, p_rendered, 'queued', p_scheduled_for, v_now
  )
  ON CONFLICT (event_id, channel, target) DO NOTHING
  RETURNING id INTO v_delivery_id;

  RETURN QUERY SELECT v_event_id, v_delivery_id, v_delivery_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
