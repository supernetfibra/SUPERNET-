-- =============================================================================
-- 008 — Pausa configurável entre mensagens (ritmo do canal)
-- =============================================================================
-- A configuração de ritmo vira o que o usuário entende: SEGUNDOS entre uma
-- mensagem e a outra, direto no painel. As cotas continuam existindo no banco
-- (a de novas conversas é a trava anti time-lock do WhatsApp), mas deixam de
-- ser o controle primário de ritmo — e o default sobe para um valor que não
-- deixa devedor sem aviso no dia.
--
-- Envio real antes desta migration já tinha pausa humana (2,5–9s, fixa). A
-- coluna nova só torna esse ritmo CONFIGURÁVEL: min = valor gravado, máx = 2×.
--
-- Aplicar: SQL Editor do Supabase (ou `supabase db push`).
-- =============================================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS send_gap_seconds INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN whatsapp_config.send_gap_seconds IS
  'Pausa mínima entre uma mensagem e a outra, em segundos. O envio sorteia o atraso real entre este valor e o seu dobro (jitter humano). 0 = usar o padrão do sistema (2,5–9s).';

-- Default da cota de novas conversas sobe de 20 para 200: com a pausa
-- configurável assumindo o ritmo, o teto passa a ser guarda de segurança
-- (time-lock) e não mais o limitador do alcance diário.
ALTER TABLE whatsapp_config
  ALTER COLUMN daily_new_chat_cap SET DEFAULT 200;

-- Instalações existentes com o default antigo (20) sobem para 200; valores
-- definidos de propósito (ex.: 1 ou 5) são PRESERVADOS.
UPDATE whatsapp_config SET daily_new_chat_cap = 200 WHERE daily_new_chat_cap = 20;
