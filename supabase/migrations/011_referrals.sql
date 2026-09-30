-- =============================================================================
-- 011 — Programa de Indicação ("Indique e Ganhe")
-- =============================================================================
-- Cada cliente logado recebe um link próprio com código rastreável
-- (?ref=CODIGO). Quem entra pelo link preenche o formulário de instalação que
-- já existe na landing e a solicitação guarda o código em
-- `install_requests.referral_code`. Quando o admin APROVA a solicitação, o
-- indicador ganha pontos (creditados por `credit_referral_points`), que podem
-- ser trocados por recompensas do catálogo (`referral_rewards`); o resgate
-- depende de aprovação do admin (`referral_redemptions`).
--
-- Garantias (no BANCO, não no código — mesmo padrão de `enqueue_notification`):
--   • crédito idempotente   → UNIQUE parcial em
--     referral_points_ledger (source_type, source_id, reason) com delta > 0:
--     aprovar duas vezes NÃO duplica pontos (erro 23505 = já creditado).
--   • débito atômico        → `redeem_referral_reward` debita e cria o pedido
--     numa ÚNICA transação; saldo negativo é impossível mesmo com clique duplo.
--   • máquina de estados    → transição de status do resgate é validada por
--     `referral_redemption_status_allowed()` (evita pending → applied direto).
--
-- Timestamps em epoch ms (padrão do projeto). RLS liberada para service_role
-- (backend Hono), como nas demais tabelas.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

-- Emissão do código usa apenas `random()` (built-in) e o alfabeto Crockford —
-- sem pgcrypto: a migration fica portável (Supabase, PGlite dos testes) e o
-- requisito é memorabilidade/legibilidade, não segredo criptográfico.

-- ---------------------------------------------------------------------------
-- 1. Código rastreável de cada cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_codes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code           TEXT NOT NULL,
  -- id do cliente PREFIXADO por conexão MikWeb (mesmo formato da sessão:
  -- `a:123`), para funcionar multi-conta sem ambiguidade.
  customer_ref   TEXT NOT NULL,
  referrer_name  TEXT NOT NULL,
  referrer_cpf   TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     BIGINT NOT NULL
);

-- Um código por cliente; reemitir desativa o anterior (ver ensure_referral_code).
-- Índice único em vez de restrição inline: funciona em qualquer versão do
-- Postgres e é idempotente (IF NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_codes_customer
  ON referral_codes (customer_ref);

-- O código é único entre ATIVOS (código antigo inativo pode ser reaproveitado
-- como referência histórica sem colidir).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_codes_code_active
  ON referral_codes (code) WHERE active;

CREATE INDEX IF NOT EXISTS idx_referral_codes_customer
  ON referral_codes (customer_ref);

COMMENT ON TABLE referral_codes IS
  'Código rastreável de indicação por cliente (link próprio ?ref=CODIGO).';

-- ---------------------------------------------------------------------------
-- 2. Vínculo da solicitação de instalação com a indicação
-- ---------------------------------------------------------------------------
ALTER TABLE install_requests
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE INDEX IF NOT EXISTS idx_install_requests_referral_code
  ON install_requests (referral_code) WHERE referral_code IS NOT NULL;

COMMENT ON COLUMN install_requests.referral_code IS
  'Código de indicação enviado pelo formulário (NULL = indicação orgânica).';

-- ---------------------------------------------------------------------------
-- 3. Ledger de pontos — APÊNDICE (sem update/delete)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_points_ledger (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   BIGINT NOT NULL,
  customer_ref TEXT NOT NULL,
  -- positivo = crédito, negativo = débito (resgate/ajuste)
  delta        INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  -- origem do lançamento: approval (aprovação de indicação),
  -- redemption (resgate), admin_adjust (ajuste manual)
  source_type  TEXT NOT NULL CHECK (source_type IN ('approval', 'redemption', 'admin_adjust')),
  source_id    TEXT,
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_referral_ledger_customer
  ON referral_points_ledger (customer_ref, created_at DESC);

-- IDEMPOTÊNCIA DO CRÉDITO: a aprovação da mesma indicação pode chegar duas
-- vezes (admin re-aprova, duplo clique, retry). O índice parcial recusa o
-- segundo crédito com 23505 — o backend trata como "já creditado".
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_ledger_credit
  ON referral_points_ledger (source_type, source_id, reason)
  WHERE delta > 0 AND source_id IS NOT NULL;

COMMENT ON TABLE referral_points_ledger IS
  'Ledger apêndice de pontos por cliente. Saldo = SUM(delta).';

-- ---------------------------------------------------------------------------
-- 4. Config do programa (linha única, padrão notification_config)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_config (
  id                  TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  points_per_approved INTEGER NOT NULL DEFAULT 100 CHECK (points_per_approved BETWEEN 1 AND 100000),
  updated_at          BIGINT,
  updated_by          TEXT
);

INSERT INTO referral_config (id, enabled, points_per_approved)
VALUES ('default', TRUE, 100)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Catálogo de recompensas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_rewards (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  -- custo em pontos
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  -- desconto = abatimento na fatura; bonus = bonificação/serviço;
  -- prize = premiação física/brinde
  kind        TEXT NOT NULL DEFAULT 'desconto' CHECK (kind IN ('desconto', 'bonificacao', 'premiacao')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_active
  ON referral_rewards (active, sort_order);

COMMENT ON TABLE referral_rewards IS
  'Catálogo do programa: o que o cliente pode comprar com pontos.';

-- ---------------------------------------------------------------------------
-- 6. Resgates — pedido do cliente, decisão do admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  BIGINT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_name TEXT,
  reward_id   UUID NOT NULL REFERENCES referral_rewards(id) ON DELETE RESTRICT,
  -- snapshot do custo e do título: editar/apagar a recompensa depois não
  -- reescreve o histórico do pedido.
  reward_title TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  admin_note  TEXT,
  reviewed_at BIGINT,
  -- quando o crédito foi efetivamente aplicado na fatura (MikWeb)
  applied_at  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_customer
  ON referral_redemptions (customer_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_status
  ON referral_redemptions (status);

COMMENT ON TABLE referral_redemptions IS
  'Pedidos de resgate. pending → approved/rejected; approved → applied (após lançar o crédito na fatura). rejected devolve os pontos.';

-- ---------------------------------------------------------------------------
-- 7. Funções plpgsql
-- ---------------------------------------------------------------------------

-- Código de 8 chars no alfabeto Crockford (sem I, L, O, U — evita confusão de
-- leitura). Mesmo alfabeto do módulo puro notify/referrals.ts; colisão é
-- tratada pelo retry do ensure_referral_code + unique parcial.
CREATE OR REPLACE FUNCTION referral_random_code()
RETURNS TEXT AS $$
DECLARE
  v_alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_result   TEXT := '';
  v_i        INT;
BEGIN
  FOR v_i IN 1..8 LOOP
    v_result := v_result || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
  END LOOP;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Garante o código do cliente: reusa o ativo existente ou emite um novo
-- (desativa o anterior — um link válido por cliente por vez).
CREATE OR REPLACE FUNCTION ensure_referral_code(
  p_customer_ref TEXT,
  p_name         TEXT,
  p_cpf          TEXT
) RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF p_customer_ref IS NULL OR p_customer_ref = '' THEN
    RAISE EXCEPTION 'customer_ref obrigatório';
  END IF;

  SELECT code INTO v_code
    FROM referral_codes
   WHERE customer_ref = p_customer_ref AND active
   LIMIT 1;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  -- 12 tentativas: colisão com código ativo é improvável (33^8) e o unique
  -- parcial decide — retry com novo código.
  FOR i IN 1..12 LOOP
    v_code := referral_random_code();
    BEGIN
      INSERT INTO referral_codes (code, customer_ref, referrer_name, referrer_cpf, active, created_at)
      VALUES (v_code, p_customer_ref, COALESCE(p_name, ''), COALESCE(p_cpf, ''), TRUE, (extract(epoch from now()) * 1000)::bigint)
      ON CONFLICT (customer_ref) DO NOTHING;
      IF FOUND THEN
        RETURN v_code;
      END IF;
      -- conflito com customer_ref (corrida): outro processo emitu primeiro
      SELECT code INTO v_code
        FROM referral_codes
       WHERE customer_ref = p_customer_ref AND active
       LIMIT 1;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- código duplicado: tenta outro
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'Não foi possível gerar código de indicação único';
END;
$$ LANGUAGE plpgsql;

-- Crédito IDEMPOTENTE: chamar duas vezes com a mesma fonte não duplica
-- (unique parcial recusa; a função devolve inserted=false).
CREATE OR REPLACE FUNCTION credit_referral_points(
  p_customer_ref TEXT,
  p_delta        INTEGER,
  p_reason       TEXT,
  p_source_type  TEXT,
  p_source_id    TEXT,
  p_created_by   TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_created BOOLEAN := FALSE;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta não pode ser zero';
  END IF;
  INSERT INTO referral_points_ledger (created_at, customer_ref, delta, reason, source_type, source_id, created_by)
  VALUES ((extract(epoch from now()) * 1000)::bigint, p_customer_ref, p_delta, p_reason, p_source_type, p_source_id, p_created_by);
  v_created := TRUE;
  RETURN json_build_object('inserted', v_created);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('inserted', FALSE);
END;
$$ LANGUAGE plpgsql;

-- Débito + pedido numa ÚNICA transação: o saldo nunca fica negativo e o
-- duplo clique não cria dois pedidos (o segundo recai no UPDATE concorrente
-- e revalida o saldo — SELECT FOR UPDATE serializa).
CREATE OR REPLACE FUNCTION redeem_referral_reward(
  p_customer_ref TEXT,
  p_reward_id    UUID,
  p_customer_name TEXT
) RETURNS JSON AS $$
DECLARE
  v_reward referral_rewards%ROWTYPE;
  v_balance INTEGER;
  v_redemption referral_redemptions%ROWTYPE;
  v_redemption_id UUID;
BEGIN
  -- Trava a "conta" do cliente: serializa resgates concorrentes do mesmo
  -- cliente. FOR UPDATE com agregado não existe no Postgres — trava-se as
  -- LINHAS primeiro, depois soma (a soma lê o mesmo conjunto travado).
  PERFORM 1 FROM referral_points_ledger WHERE customer_ref = p_customer_ref FOR UPDATE;
  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM referral_points_ledger
   WHERE customer_ref = p_customer_ref;

  SELECT * INTO v_reward FROM referral_rewards WHERE id = p_reward_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recompensa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_reward.active THEN
    RAISE EXCEPTION 'Recompensa indisponível' USING ERRCODE = 'P0001';
  END IF;

  IF v_balance < v_reward.points_cost THEN
    RAISE EXCEPTION 'Saldo insuficiente' USING ERRCODE = 'P0001';
  END IF;

  -- Dedupe de duplo clique: pedido pendente do MESMO prêmio nos últimos 60s
  -- devolve o pedido existente em vez de criar outro (a trava acima serializa;
  -- isto cobre o segundo clique que chega depois da transação anterior).
  DECLARE
    v_recent UUID;
  BEGIN
    SELECT id INTO v_recent
      FROM referral_redemptions
     WHERE customer_ref = p_customer_ref
       AND reward_id = p_reward_id
       AND status = 'pending'
       AND created_at > (extract(epoch from now()) * 1000)::bigint - 60000
     LIMIT 1;
    IF v_recent IS NOT NULL THEN
      RETURN json_build_object('redemptionId', v_recent, 'balance', v_balance, 'duplicate', TRUE);
    END IF;
  END;

  INSERT INTO referral_redemptions (created_at, customer_ref, customer_name, reward_id, reward_title, points_cost, status)
  VALUES ((extract(epoch from now()) * 1000)::bigint, p_customer_ref, p_customer_name, v_reward.id, v_reward.title, v_reward.points_cost, 'pending')
  RETURNING * INTO v_redemption;
  v_redemption_id := v_redemption.id;

  PERFORM credit_referral_points(p_customer_ref, -v_reward.points_cost, 'redemption', 'redemption', v_redemption_id::text, p_customer_ref);

  RETURN json_build_object(
    'redemptionId', v_redemption_id,
    'balance', v_balance - v_reward.points_cost
  );
END;
$$ LANGUAGE plpgsql;

-- Máquina de estados do resgate (nega transições inválidas).
CREATE OR REPLACE FUNCTION referral_redemption_status_allowed(from_status TEXT, to_status TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (from_status = 'pending'  AND to_status IN ('approved', 'rejected'))
      OR (from_status = 'approved' AND to_status = 'applied')
      OR (from_status = 'rejected' AND to_status = 'approved'); -- reverter rejeição (erro admin)
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- RLS (service-role do backend acessa tudo; sem policies públicas)
-- =============================================================================
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON referral_codes FOR ALL USING (true);
CREATE POLICY "Service role full access" ON referral_points_ledger FOR ALL USING (true);
CREATE POLICY "Service role full access" ON referral_config FOR ALL USING (true);
CREATE POLICY "Service role full access" ON referral_rewards FOR ALL USING (true);
CREATE POLICY "Service role full access" ON referral_redemptions FOR ALL USING (true);
