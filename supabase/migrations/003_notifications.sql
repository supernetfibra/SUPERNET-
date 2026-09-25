-- =============================================================================
-- 003 — Notificações (outbox) + WhatsApp via UazAPI
-- =============================================================================
-- Estrutura descrita em NOTIFICACOES-HUB.md §6 e LEMBRETES-WHATSAPP.md §4.
--
-- O ponto central desta migration são as duas funções no fim do arquivo:
--   enqueue_notification(...)            → grava evento + entrega de forma idempotente
--   claim_notification_deliveries(...)   → reserva um lote para envio sem duplicar
-- Toda a garantia de "não enviar duas vezes a mesma cobrança" mora aqui, no banco,
-- e não em verificação no código da aplicação (que corre com dispatcher duplicado).
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

-- =============================================================================
-- 1. CONFIGURAÇÃO DA INTEGRAÇÃO WHATSAPP (UazAPI)
-- =============================================================================
-- Espelha o padrão de `mikweb_config`: os secrets de ambiente têm prioridade, a
-- tabela é o fallback editável pelo painel admin.

CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL DEFAULT 'default',
  base_url TEXT NOT NULL DEFAULT '',
  admin_token TEXT NOT NULL DEFAULT '',
  instance_token TEXT NOT NULL DEFAULT '',
  instance_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_new_chat_cap INT NOT NULL DEFAULT 20,
  per_customer_cap INT NOT NULL DEFAULT 1,
  window_start INT NOT NULL DEFAULT 9,
  window_end INT NOT NULL DEFAULT 20,
  paused_until BIGINT,
  last_status TEXT,
  last_status_at BIGINT,
  updated_at BIGINT NOT NULL DEFAULT 0,
  updated_by TEXT
);

INSERT INTO whatsapp_config (key, updated_at)
VALUES ('default', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. CONTATOS E CONSENTIMENTO
-- =============================================================================
-- `opt_in` é a autorização; `opt_out_at` vence. O telefone fica no formato que a
-- UazAPI exige (E.164 sem "+", só dígitos), já normalizado pelo backend.

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id TEXT UNIQUE NOT NULL,
  cpf TEXT,
  customer_name TEXT,
  phone_e164 TEXT NOT NULL,
  opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  opt_in_at BIGINT,
  opt_out_at BIGINT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_error TEXT,
  last_error_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_cpf ON whatsapp_contacts(cpf);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_opt_in ON whatsapp_contacts(opt_in);

-- =============================================================================
-- 3. EVENTOS (intenção) E ENTREGAS (outbox)
-- =============================================================================
-- Dois níveis de idempotência, de propósito:
--   notification_events.dedupe_key   → "esta cobrança, nesta regra" só existe 1×
--   UNIQUE(event_id, channel, target) → "esta entrega, neste destino" só existe 1×

CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_key TEXT NOT NULL,
  customer_id TEXT,
  cpf TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  priority TEXT NOT NULL DEFAULT 'marketing',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_events_customer ON notification_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  customer_id TEXT,
  cpf TEXT,
  target TEXT NOT NULL,
  -- Renderizado no momento do ENVIO (não no enfileiramento): um aviso de atraso
  -- agendado para depois precisa contar os dias do dia em que sai.
  rendered JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  scheduled_for BIGINT NOT NULL,
  provider_id TEXT,
  error_key TEXT,
  error_message TEXT,
  sent_at BIGINT,
  status_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE (event_id, channel, target)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_queue
  ON notification_deliveries(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_customer
  ON notification_deliveries(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider
  ON notification_deliveries(provider_id);

-- =============================================================================
-- 4. AUDITORIA — liberar os novos tipos no CHECK existente
-- =============================================================================
-- O CHECK da migration 001 foi declarado em linha, então o Postgres o nomeou
-- automaticamente como `mikweb_audit_log_type_check`.

ALTER TABLE mikweb_audit_log DROP CONSTRAINT IF EXISTS mikweb_audit_log_type_check;
ALTER TABLE mikweb_audit_log ADD CONSTRAINT mikweb_audit_log_type_check CHECK (type IN (
  'login_success', 'login_failure', 'login_rate_limited',
  'billing_error', 'billing_access', 'logout',
  'barcode_copied', 'pix_copied', 'pdf_viewed',
  'whatsapp_sent', 'whatsapp_failed', 'whatsapp_skipped',
  'whatsapp_opt_in', 'whatsapp_opt_out', 'whatsapp_config'
));

-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================
-- Mesmo modelo da migration 001: o backend usa service_role e responde por toda a
-- autorização; o RLS está aqui para o caso de acesso direto pelo cliente.

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON whatsapp_config;
DROP POLICY IF EXISTS "Service role full access" ON whatsapp_contacts;
DROP POLICY IF EXISTS "Service role full access" ON notification_events;
DROP POLICY IF EXISTS "Service role full access" ON notification_deliveries;

CREATE POLICY "Service role full access" ON whatsapp_config FOR ALL USING (true);
CREATE POLICY "Service role full access" ON whatsapp_contacts FOR ALL USING (true);
CREATE POLICY "Service role full access" ON notification_events FOR ALL USING (true);
CREATE POLICY "Service role full access" ON notification_deliveries FOR ALL USING (true);

-- =============================================================================
-- 6. ENQUEUE IDEMPOTENTE (transação única: evento + entrega)
-- =============================================================================
-- Chame sempre por aqui, nunca com INSERT direto. Se a chave de deduplicação já
-- existe, a função NÃO cria nova entrega e devolve `created = false` — é assim que
-- o botão "enviar agora" pode ser clicado duas vezes sem mandar duas mensagens.
--
-- ATENÇÃO (achado na verificação contra um Postgres real, ver
-- `scripts/check-notifications-sql.mjs`): o corpo desta função está DUPLICADO na
-- migration 005. Motivo: `ON CONFLICT (event_id, channel, target)` referencia uma
-- coluna com o mesmo nome de um parâmetro de saída (`event_id`), e o plpgsql recusa
-- isso em tempo de execução com "column reference is ambiguous" — erro que só
-- apareceria na PRIMEIRA cobrança enviada, não ao aplicar a migration.
-- `#variable_conflict use_column` resolve; quem já aplicou esta migration recebe a
-- correção ao aplicar a 005 (Supabase não re-executa migration já aplicada).
-- Alterar aqui exige alterar lá.

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

-- =============================================================================
-- 7. CLAIM ATÔMICO DA FILA
-- =============================================================================
-- `FOR UPDATE SKIP LOCKED` é o que permite dois dispatchers rodando ao mesmo
-- tempo sem que os dois peguem a mesma entrega. Sem isso, um disparo duplicado é
-- questão de tempo (e o WhatsApp não perdoa volume duplicado).
--
-- `attempts` é incrementado no claim: uma execução que morre depois do claim já
-- conta a tentativa, evitando retry infinito em item problemático.

CREATE OR REPLACE FUNCTION claim_notification_deliveries(
  p_limit INT,
  p_channel TEXT DEFAULT NULL,
  p_now BIGINT DEFAULT NULL,
  p_ids UUID[] DEFAULT NULL
)
RETURNS SETOF notification_deliveries AS $$
  UPDATE notification_deliveries d
     SET status = 'sending',
         attempts = d.attempts + 1
   WHERE d.id IN (
     SELECT id
       FROM notification_deliveries
      WHERE status = 'queued'
        AND scheduled_for <= COALESCE(p_now, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
        AND (p_channel IS NULL OR channel = p_channel)
        -- Restringir a ids específicos é o que permite o botão "enviar agora"
        -- usar exatamente o mesmo caminho de envio da fila.
        AND (p_ids IS NULL OR id = ANY(p_ids))
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 1)
   )
  RETURNING *;
$$ LANGUAGE sql;

-- Devolve a entrega para a fila desfazendo o `attempts` do claim: nada foi
-- tentado (cota estourada ou canal em time-lock), então não é tentativa.

CREATE OR REPLACE FUNCTION release_notification_delivery(
  p_id UUID,
  p_scheduled_for BIGINT,
  p_reason TEXT
)
RETURNS void AS $$
  UPDATE notification_deliveries
     SET status = 'queued',
         scheduled_for = p_scheduled_for,
         attempts = GREATEST(attempts - 1, 0),
         error_message = p_reason,
         status_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
   WHERE id = p_id;
$$ LANGUAGE sql;

-- =============================================================================
-- 8. LIMPEZA (opcional, chamável por cron)
-- =============================================================================

CREATE OR REPLACE FUNCTION clean_old_notification_deliveries(max_age_days INTEGER DEFAULT 180)
RETURNS void AS $$
BEGIN
  DELETE FROM notification_events
   WHERE created_at < ((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - (max_age_days * 24 * 60 * 60 * 1000));
END;
$$ LANGUAGE plpgsql;
