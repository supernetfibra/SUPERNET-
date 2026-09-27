-- =============================================================================
-- 006 — Payload enriquecido da entrega (botões de ação no WhatsApp)
-- =============================================================================
-- As mensagens passam a poder sair com BOTÕES de ação rápida (copiar Pix, copiar
-- código de barras, abrir PDF). A UazAPI expõe isso em `/send/menu` (type
-- `button`, choices com `copy:código` / URL). Limites e riscos documentados na
-- doc oficial: máx. 3 botões; não misturar botões de resposta com copy/url na
-- mesma mensagem; e "recursos interativos podem ser descontinuados a qualquer
-- momento" — por isso o ADAPTER tem fallback automático para texto puro.
--
-- As ações moram no evento (payload JSONB, chave `__actions`), não na entrega:
-- um reenvio do mesmo aviso reusa as ações sem nova decisão de renderização.
-- A coluna abaixo espelha as ações na ENTREGA para consulta rápida na fila
-- (outbox, histórico do cliente) sem desserializar o evento.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS actions JSONB;

COMMENT ON COLUMN notification_deliveries.actions IS
  'Botões de ação rápidos enviados com a mensagem (copiar Pix, código de barras, abrir PDF). Espelho de event.payload.__actions para consulta na fila.';

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_actions
  ON notification_deliveries (channel, created_at)
  WHERE actions IS NOT NULL;
