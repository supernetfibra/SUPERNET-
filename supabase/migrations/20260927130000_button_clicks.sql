-- =============================================================================
-- 007 — Cliques em botões de ação rápida (WhatsApp)
-- =============================================================================
-- Os lembretes saem com até 3 botões (copiar Pix, copiar código de barras,
-- abrir portal/PDF — ver 20260927120000_message_actions.sql). Quando o cliente
-- TOCA num botão, a UazAPI entrega o evento pelo webhook de mensagens com
-- messageType `buttonsResponseMessage` (texto do botão em selectedDisplayText,
-- ID da mensagem original em contextInfo.stanzaId). Este handler registra o
-- clique e casa com a entrega pelo provider_id — e a view agrega o uso real
-- (quantos clientes usam o Pix copiável, por exemplo) para o painel.
--
-- Idempotência: UNIQUE (stanza_id, button_label) — reprocessar o mesmo evento
-- não duplica. A tabela é apêndice (append-only); sem UPDATE/DELETE.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_button_clicks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   BIGINT NOT NULL,
  phone_e164   TEXT,
  button_label TEXT,
  selected_row TEXT,
  message_id   TEXT,
  provider_id  TEXT,
  delivery_id  UUID REFERENCES notification_deliveries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_button_clicks_created
  ON whatsapp_button_clicks (created_at DESC);

-- Idempotência: a UazAPI pode reentregar o mesmo evento; o message_id da RESPOSTA
-- identifica o clique unicamente (clicks sem message_id nunca duplicam por esta via).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_button_clicks_message
  ON whatsapp_button_clicks (message_id)
  WHERE message_id IS NOT NULL;

COMMENT ON TABLE whatsapp_button_clicks IS
  'Cliques em botões de ação rápida reportados pela UazAPI (buttonsResponseMessage). Casados com a entrega por provider_id quando possível.';

-- ---------------------------------------------------------------------------
-- Métricas agregadas (30 dias) para o painel — uma linha por rótulo de botão.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW whatsapp_button_click_stats AS
SELECT
  button_label,
  count(*)                                            AS clicks,
  count(DISTINCT phone_e164)                          AS unique_phones,
  count(*) FILTER (WHERE delivery_id IS NOT NULL)     AS matched,
  count(*) FILTER (WHERE delivery_id IS NULL)         AS unmatched,
  to_timestamp(max(created_at) / 1000.0)              AS last_click_at
FROM whatsapp_button_clicks
-- 30 dias: segundos → ms. NÃO multiplicar inteiros literais além do int4
-- (30 * 86400 * 1000 = 2.592.000.000 estoura o máximo de 2.147.483.647 e a
-- view falha com `integer out of range` na leitura).
WHERE created_at >= (extract(epoch from now()) - 30 * 86400) * 1000
GROUP BY button_label
ORDER BY clicks DESC;
