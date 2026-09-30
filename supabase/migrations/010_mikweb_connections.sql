-- =============================================================================
-- 010 — MULTI-CONTA MIKWEB (duas contas do ERP, um único canal SaaS)
-- =============================================================================
-- O provedor tem duas contas MikWeb distintas (bases de clientes SEM sobreposição
-- de CPF) e um único canal de área do cliente. Até aqui as credenciais viviam em
-- UMA linha de `mikweb_config` — esta migration cria a tabela de conexões, importa
-- a credencial atual como a primeira conexão ("Conta A") e marca a ORIGEM de cada
-- dado já existente, para que ids de fatura/cliente de contas diferentes não
-- colidam:
--
--   cliente 123 da Conta A → "a:123"      (whatsapp_contacts, push_subscriptions)
--   evento da fatura 456   → "billing:a:456:<regra>"   (notification_events)
--   sessão do portal       → connection_slug = 'a'     (mikweb_sessions)
--
-- Tudo idempotente: rodar duas vezes não duplica nem re-prefixa.

-- -----------------------------------------------------------------------------
-- 1. TABELA DE CONEXÕES
-- -----------------------------------------------------------------------------
-- Um `slug` curto e estável (`a`, `b`, …) entra nos ids prefixados — nunca use o
-- UUID aqui: trocar de credencial teria que reescrever todo o histórico.
CREATE TABLE IF NOT EXISTS mikweb_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  api_url TEXT NOT NULL DEFAULT '',
  api_token TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  last_test_ok BOOLEAN,
  last_test_at BIGINT,
  last_test_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT
);

ALTER TABLE mikweb_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON mikweb_connections;
CREATE POLICY "Service role full access" ON mikweb_connections FOR ALL USING (true);

-- -----------------------------------------------------------------------------
-- 2. MIGRAÇÃO DA CREDENCIAL ATUAL → CONEXÃO 'a'
-- -----------------------------------------------------------------------------
-- Só cria a conexão A se não existir nenhuma linha (idempotente) e há credencial
-- em mikweb_config. Secrets de ambiente (MIKWEB_API_URL/TOKEN) continuam valendo
-- como fallback da conexão A no código — nada a fazer aqui por eles.
INSERT INTO mikweb_connections (slug, label, api_url, api_token, active, sort_order, created_at, updated_at, updated_by)
SELECT
  'a',
  'Conta A',
  c.api_url,
  c.api_token,
  TRUE,
  0,
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  'migration-010'
FROM mikweb_config c
WHERE c.key = 'default'
  AND COALESCE(c.api_url, '') <> ''
  AND COALESCE(c.api_token, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM mikweb_connections);

-- mikweb_config continua existindo (branding: provider_name/logo_url); as
-- credenciais dela deixam de ser lidas pelo backend depois do deploy.

-- -----------------------------------------------------------------------------
-- 3. SESSÕES DO PORTAL: de qual conta é a sessão
-- -----------------------------------------------------------------------------
-- Sessões abertas na hora do deploy eram da credencial única → Conta A.
ALTER TABLE mikweb_sessions ADD COLUMN IF NOT EXISTS connection_slug TEXT NOT NULL DEFAULT 'a';

-- -----------------------------------------------------------------------------
-- 4. BACKFILL DE ORIGEM
-- -----------------------------------------------------------------------------
-- Formato NOVO = prefixado (não toca). Formato ANTIGO = sem ':' no id → vira 'a:'.
-- Eventos: `billing:<id>:<regra>` → `billing:a:<id>:<regra>`
UPDATE notification_events
SET dedupe_key = 'billing:a:' || split_part(dedupe_key, ':', 2) || ':' || split_part(dedupe_key, ':', 3)
WHERE dedupe_key ~ '^billing:[^:]+:[a-z0-9_-]+$';

-- Contatos de WhatsApp: `<id>` → `a:<id>` (customer_id é UNIQUE: sem colisão).
UPDATE whatsapp_contacts
SET customer_id = 'a:' || customer_id
WHERE customer_id NOT LIKE '%:%';

-- Inscrições de push (mikweb_sessions): mesmo tratamento.
UPDATE push_subscriptions
SET customer_id = 'a:' || customer_id
WHERE customer_id IS NOT NULL
  AND customer_id <> ''
  AND customer_id NOT LIKE '%:%';

-- -----------------------------------------------------------------------------
-- 5. ÍNDICE ÚTIL (listagem das conexões ativas em ordem)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mikweb_connections_sort ON mikweb_connections(active, sort_order);
