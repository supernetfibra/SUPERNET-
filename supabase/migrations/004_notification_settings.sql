-- =============================================================================
-- 004 — Configuração do pipeline de notificações (régua de lembretes)
-- =============================================================================
-- Fecha o buraco que o simulador deixou visível: a régua de lembretes vivia só em
-- `DEFAULT_RULES` (código) e as cotas do simulador vinham de parâmetros de URL. Com
-- esta tabela, o que o simulador simula é a mesma configuração que o dispatcher lê.
--
-- Divisão de donos (deliberada):
--   notification_config.settings → régua, horizonte, hora de execução, base do portal
--   whatsapp_config              → cota, janela, ligado/desligado (migration 003)
-- Um dono por chave: editar a cota é um só lugar, editar a régua é outro.
--
-- `settings = '{}'` significa "nada salvo ainda": o código usa a régua padrão
-- (`DEFAULT_SETTINGS` em `notify/settings.ts`). O painel mostra a origem
-- (`db`/`defaults`) e o fingerprint, então esse estado nunca é ambíguo.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL DEFAULT 'default',
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at BIGINT NOT NULL DEFAULT 0,
  updated_by TEXT,
  -- Guarda no banco: um documento que não é objeto (array, string) quebraria a
  -- leitura no backend. Barrado aqui, o erro aparece no momento de salvar.
  CONSTRAINT notification_config_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

INSERT INTO notification_config (key, settings, updated_at)
VALUES ('default', '{}'::JSONB, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_notification_config_updated ON notification_config(updated_at);

ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON notification_config;
CREATE POLICY "Service role full access" ON notification_config FOR ALL USING (true);

-- =============================================================================
-- AUDITORIA — liberar o novo tipo (mesma lista da 003 + notification_config)
-- =============================================================================

ALTER TABLE mikweb_audit_log DROP CONSTRAINT IF EXISTS mikweb_audit_log_type_check;
ALTER TABLE mikweb_audit_log ADD CONSTRAINT mikweb_audit_log_type_check CHECK (type IN (
  'login_success', 'login_failure', 'login_rate_limited',
  'billing_error', 'billing_access', 'logout',
  'barcode_copied', 'pix_copied', 'pdf_viewed',
  'whatsapp_sent', 'whatsapp_failed', 'whatsapp_skipped',
  'whatsapp_opt_in', 'whatsapp_opt_out', 'whatsapp_config',
  'notification_config'
));
