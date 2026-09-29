-- 009 — admin_alerts_state: memória do anti-spam dos alertas de operação.
--
-- O sistema avisa o admin por WhatsApp/push quando o canal para ou a rodada de
-- envio acumula falhas. Para não virar spam (cron roda a cada 5 min), cada tipo
-- de alerta só reavisa depois do cooldown — e a memória do "último envio" precisa
-- sobreviver a cold start da Edge Function. Uma linha, key 'default'.
--
-- Config do alerta (número do admin, gatilhos) mora em notification_config.settings
-- (JSONB, chave `adminAlerts`) — herdada da migration 004, sem coluna nova.

CREATE TABLE IF NOT EXISTS admin_alerts_state (
  key TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

COMMENT ON TABLE admin_alerts_state IS
  'Anti-spam dos alertas de operação: último envio (ms) por tipo (channel-down, dispatch-failures, quota-paused).';

-- RLS: só o service role (Edge Function) toca nesta tabela.
ALTER TABLE admin_alerts_state ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_alerts_state' AND policyname = 'admin_alerts_state_service_all'
  ) THEN
    CREATE POLICY admin_alerts_state_service_all ON admin_alerts_state
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
