# HANDOFF — Área do Cliente Supernet Fibra

> Documento de continuidade do projeto. Qualquer pessoa (ou sessão de agente) deve
> conseguir retomar o trabalho daqui. Última atualização: **2026-09-30** — programa de indicação completo no commit `da4ccb8`, **pendente de aplicar em produção** (migration 011 + deploy da função + build Vercel; ver §9 e §10.7).
>
> Docs complementares: `DEPLOY-SUPABASE.md` (passo a passo de deploy),
> `LEMBRETES-WHATSAPP.md` (design completo da régua de lembretes), `NOTIFICACOES-HUB.md` (hub de notificações).

---

## 1. O que é o projeto

Portal do assinante da **Supernet Fibra**: cliente consulta faturas (MikWeb ERP),
solicita instalação, indica amigos pelo link próprio ("Indique e Ganhe": pontos por
aprovação, trocáveis por descontos), recebe notificações push e **lembretes de fatura
por WhatsApp** (UazAPI), com régua configurável e funil de engajamento no painel admin.

| Camada | Tecnologia | Onde roda |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind v4 + shadcn/ui + React Router v7 (`react-router`, nunca `react-router-dom`) | Vercel (estático, `dist/`) |
| Backend | **Supabase Edge Function** (`api`, Hono) — única porta do frontend para dados | Supabase `ssvwlbwsprjpfmevdnvb` |
| Banco | Postgres Supabase + pg_cron + pg_net + Vault | Supabase |
| ERP | MikWeb (API REST) — fonte de verdade de clientes/faturas | externo |
| WhatsApp | UazAPI (instância conectada; envio, status, cliques, opt-out) | externo |

- Repositório: `supernetfibra/SUPERNET-` (GitHub, **público**), branch `main`.
- URL da função: `https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/...`
- Projeto Supabase: https://supabase.com/dashboard/project/ssvwlbwsprjpfmevdnvb

⚠️ **Segurança**: o repo é público e `DEPLOY-SUPABASE.md` contém senha admin do
MikWeb (`MIKWEB_ADMIN_PASSWORD`) e chaves VAPID em texto plano. Pendência urgente:
rotacionar essas credenciais e limpar o documento (ver §10).

---

## 2. Como retomar de onde parou (checklist de sessão)

1. Ler este documento e `git log --oneline -10`.
2. Verificar saúde: `npm run verify:notify` (typechecks + 316 checks + 37 SQL + 22 referrals + bundle da função) e `npm run build`.
3. Ver produção direto no banco (CLI logado): `npx supabase db query --linked "..."`.
4. Ver cron ativo: `npx supabase db query --linked "SELECT jobname, schedule, active FROM cron.job;"`.
5. Deploy de mudanças no backend: `npm run deploy:functions`. Deploy de migrations: SQL Editor ou `npx supabase db push` — **e registrar no histórico** (Local = Remote).
6. Commit no padrão do repo: `feat:`/`fix:` em pt-BR, corpo explicando o PORQUÊ, rodapé Codebuff.

> ⚠️ `code_search` (ripgrep) pode falhar nesta máquina (ENOTDIR) — usar `grep -rn` pelo terminal.
> Env vars de sessão (ADMIN_EMAIL/ADMIN_PASSWORD) NÃO sobrevivem a restart do Freebuff;
> para validar endpoints admin ao vivo, use `npx supabase db query --linked` ou gere token via `POST /admin/login`.

---

## 3. Comandos essenciais

```bash
npm run dev                 # Vite local
npm run build               # tsc -b + vite build + version.json (o que vai para a Vercel)
npm run deploy:functions    # npx supabase functions deploy api --no-verify-jwt
npm run verify:notify       # typecheck:notify + check:notify + check:sql + check:referrals + typecheck:api
npm run check:notify        # 447 verificações do pipeline de notificações (Node roda TS direto)
npm run check:sql           # 37 verificações de SQL
npm run check:referrals     # 22 verificações do programa de indicação (PGlite, migration 011)
npm run simulate            # CLI do simulador de lembretes (scripts/simulate-reminders.ts)
```

- `typecheck:notify` cobre `supabase/functions/api/notify/**` (módulos puros fora do tsconfig do app).
- `typecheck:api` (`scripts/check-edge-function.mjs`) empacota `index.ts` com esbuild e roda
  tsc no bundle procurando nomes indefinidos — **é o único typecheck que cobre `index.ts`**,
  que importa de `esm.sh` e por isso não entra em nenhum tsconfig. Já pegou bugs reais; rode sempre.
- Node >= 24 executa os módulos TS dos testes por type-stripping nativo: os módulos em
  `notify/` não podem usar enum/namespace/parameter properties (`erasableSyntaxOnly`).

---

## 4. Arquitetura

### Frontend (`src/`)
- Páginas admin: `AdminDashboard` (com card de métricas de indicações), `AdminSettings` (branding, config MikWeb, **WhatsApp completo**),
  `AdminOutbox` (fila de envios com botões), `AdminSimulator` (simulador da régua), `AdminInstallRequests`, `AdminReferrals` (indicações, catálogo, resgates, config).
- Páginas cliente: login por CPF, faturas (`Invoices`), perfil, instalação, `Referrals` ("Indique e Ganhe": link + QR + catálogo + histórico).
- `src/lib/api-config.ts`: `adminFetch()`/`apiUrl()` — sessões via headers (`x-session-token` cliente,
  `x-admin-token` admin), nunca cookies cross-origin.
- `src/lib/engagement-types.ts`: ponte de types do funil com o módulo puro do backend. `src/lib/referral-api.ts`: idem para indicações.
- `Landing.tsx` lê `?ref=`, valida no backend e envia o código no formulário de instalação existente (banner com o 1º nome do indicador).

### Backend (`supabase/functions/api/`)
- `index.ts` (~4200 linhas): todos os endpoints Hono + helpers. Base path `/api`.
- `notify/` — núcleo puro, injetado (testável sem banco):
  - `model.ts` — datas civis no fuso `UTC-3` (`DEFAULT_TZ_OFFSET_MINUTES = -180`), telefone E.164, classificação de faturas.
  - `sync.ts` — régua → fila: varre janela de vencimentos e enfileira avisos (`enqueue_notification`).
  - `dispatch.ts` — dispatcher: claim, janela de envio, cotas (novas conversas e por cliente), envio, marcações.
  - `outbox.ts` — única porta de escrita das entregas. Idempotência GARANTIDA NO BANCO (`enqueue_notification`, `claim_notification_deliveries`), não no código.
  - `templates.ts` — render pt-BR + `buildActions` (botões Pix/código de barras/portal/PDF) + `toStoredPayload` (`__actions`, `__dueDate`).
  - `webhook.ts` — eventos UazAPI: status (delivered/read/failed), opt-out por palavra-chave, cliques em botões.
  - `settings.ts` / `settings-store.ts` — régua (máx 12 regras, offset −60…+60) + config do canal, com fingerprint.
  - `template-store.ts`, `simulate.ts`, `routing.ts`, `reach.ts`, `sources.ts` (leitura MikWeb),
    `uazapi.ts` (cliente HTTP), `channel.ts`, `config.ts`, `runtime.ts`, `demo-data.ts`, `engagement.ts` (funil semanal).
  - `referrals.ts` (lógica de indicações: código, view models, aviso de aprovação),
    `referral-metrics.ts` (métricas do card do dashboard, corte por mês civil BRT).

### Modelo de autenticação
- Cliente: `POST /mikweb/login` (CPF + senha na MikWeb) → session token.
- Admin: `POST /admin/login` (senha `MIKWEB_ADMIN_PASSWORD`) → token admin.
- Cron: header `x-cron-secret` (`requireCron`), secret em DOIS lugares sincronizados (ver §7).
- Webhook UazAPI: `?secret=` na URL (gerada pronta no painel; sem secret ainda aceita, com aviso).
- Convenção de endpoints: falha por migration pendente devolve vazio + flag `pending` (HTTP 200), **nunca 500**.

---

## 5. Banco de dados (migrations)

**001–010 aplicadas em produção. A `011_referrals.sql` ainda NÃO foi aplicada** (conferido
em 30/09: todas as tabelas `referral_*` NULL e `install_requests.referral_code` ausente) —
aplicar no SQL Editor e então registrar no histórico (Local = Remote). Ordem cronológica:

| Migration | Conteúdo |
|---|---|
| `001_initial_schema.sql` | Sessões, config/branding, audit logs, solicitações de instalação, push_subscriptions |
| `002_add_install_request_photos.sql` | Fotos das solicitações |
| `003_notifications.sql` | `notification_events` + `notification_deliveries` + funções idempotentes (`enqueue_notification`, `claim_notification_deliveries`, `release_notification_delivery`) |
| `004_notification_settings.sql` | Régua (`notification_config`) + templates + config do canal WhatsApp |
| `005_new_chat_quota.sql` | Cota diária de NOVAS conversas (`reserve_new_chat_slot`) — falha aberta, declarada no resumo |
| `20260927120000_message_actions.sql` | Coluna `actions` JSONB em `notification_deliveries` (espelho dos botões enviados) |
| `20260927130000_button_clicks.sql` | `whatsapp_button_clicks` (apêndice, idempotente por `message_id`) + view `whatsapp_button_click_stats` |
| `20260928100000_send_gap.sql` | Ritmo configurável de envio (`send_gap_seconds`) |
| `009_admin_alerts_state.sql` | Estado dos alertas de operação (`admin_alerts_state`, key `default`) |
| `010_mikweb_connections.sql` | **Multi-conta MikWeb**: tabela `mikweb_connections` + migração da credencial única para a conexão `a` + backfill de origem (`billing:a:<id>:<regra>`, contatos/push `a:<id>`) + `mikweb_sessions.connection_slug` (idempotente) |
| `011_referrals.sql` | **Programa de indicação (PENDENTE EM PRODUÇÃO)**: `referral_codes` (código rastreável por cliente), `referral_points_ledger` (apêndice, crédito idempotente por unique parcial), `referral_config`, `referral_rewards`, `referral_redemptions` + funções plpgsql (`ensure_referral_code`, `credit_referral_points`, `redeem_referral_reward` — débito atômico) + `install_requests.referral_code` |

Datas são **epoch ms** (`created_at`, `sent_at`, `status_at`). Cuidado com overflow int4 em
literais SQL (`30 * 86400 * 1000` estoura — usar `(extract(epoch from now()) - 30*86400) * 1000`).

---

## 6. Endpoints (resumo de superfície)

- **Cliente MikWeb**: `login`, `logout`, `me`, `customer`, `select-contact`, `billings`, `billings/:id/download`, `action`.
- **Admin geral**: `login/logout/verify`, `branding`, `config` (MikWeb, só branding+legado), `test-connection`, `audit-logs`, `sessions` (+ revoke), `customer` (busca multi-conta, devolve `connection`), `push`, `install-requests` (+ status).
- **Multi-conta MikWeb**: `GET/POST /admin/connections`, `POST /admin/connections/:id/update|test|toggle`, `DELETE /admin/connections/:id` (token nunca volta na resposta; última ativa não sai).
- **Indicações** (migration 011): cliente `GET /referrals/me` (link, saldo, histórico), `POST /referrals/redeem`, `GET /admin/referrals/stats` (métricas do card do dashboard, corte por mês civil BRT); público `GET /public/referral/:code` (só 1º nome — LGPD) e `GET /public/referral-catalog`; admin `GET /admin/referrals` (+lista+stats), `POST /admin/referrals/config|adjust|rewards`, `PUT/DELETE /admin/referrals/rewards/:id`, `POST /admin/referrals/redemptions/:id/decision`. Aprovar instalação (`/admin/install-requests/:id/status` → approved) credita pontos via `credit_referral_points` (idempotente no banco; migration pendente ou erro NUNCA reverte a aprovação) e enfileira o **aviso de aprovação por WhatsApp** (`enqueueReferralApprovedNotice`): sai pela MESMA outbox/dispatcher/UazAPI dos lembretes (opt-out, janela, cotas de graça), template editável `referral.approved` no editor de mensagens (só WhatsApp — sem default push), dedupe key `referral:<id>:approval` = a do crédito (aprovar 2× não credita e não reenvia), só envia com opt-in em `whatsapp_contacts`, `saldo` no payload é o pós-crédito, todo erro é best-effort logado. Suíte própria: `npm run check:referrals` (PGlite, 22 checks) + seção 16 do `check:notify`.
- **Notificações**: `GET/POST /admin/notifications/templates`, `settings` (régua), `simulate` (dry-run multi-conta),
  `deliveries` (outbox), `deliveries/retry`, `deliveries/cancel`, `send-now` (aceita `connection` para validar a fatura na conta de origem).
- **WhatsApp**: `GET/POST /admin/whatsapp/config`, `connect` (QR/pairing), `test` (sonda ou evento da régua),
  `import-contacts` (dry-run opcional), `button-stats` (cliques 30d), `engagement-funnel` (funil semanal).
- **Públicos**: `POST /webhooks/uazapi` (status/opt-out/cliques), `POST /public/install-request`, `POST /push/subscribe|unsubscribe|test`.
- **Cron** (`x-cron-secret`): `cron/notify-sync` (régua→fila), `cron/notify-dispatch` (envia), `cron/whatsapp-import-contacts`.
- **Funil de engajamento** (`GET /admin/whatsapp/engagement-funnel?weeks=8`): agrega por semana (seg–dom, fuso do projeto)
  enviados → entregues → lidos → clicaram no Pix. Coorte por `sent_at` (leitura atrasada NÃO infla a semana seguinte);
  funil cumulativo (entregue ⊇ lido). Agregação pura em `notify/engagement.ts` + `src/lib/engagement-types.ts`.

---

## 7. WhatsApp / UazAPI — como funciona hoje

- **Config** vive no banco (painel); secrets `UAZAPI_*` têm prioridade. Instância: conectada.
- **Envio**: janela 10h–16h BRT, `per_customer_cap=1`, `daily_new_chat_cap=1` ⚠️ (teto diário de novas
  conversas em 1 — decisão pendente do usuário subir; não mexer sem ok).
- **Botões de ação rápida**: até 3 por mensagem (`Copiar código Pix` copy, `Copiar código de barras` copy,
  `Abrir portal`/`Baixar PDF` url) via `POST /send/menu` `{choices: ["Rótulo|copy:CÓDIGO", "Rótulo|url"]}`,
  com fallback automático para texto puro (`📋 Rótulo: código`) se o menu for recusado. Confirmado funcionando.
- **Webhook** (`/webhooks/uazapi`): atualiza delivered/read/failed por `provider_id`; opt-out por texto
  (PARAR/SAIR/CANCELAR/DESCADASTRAR; `cancelar` só na 1ª palavra); registra cliques
  (`buttonsResponseMessage` → `selectedDisplayText` + `contextInfo.stanzaId`, casa com a entrega por
  `provider_id` ou pela última entrega com o rótulo ao telefone). Parser aceita telefone na raiz OU
  aninhado em `message` (formato da doc — sem isso opt-out/clique ficavam sem telefone).
- **Importação de opt-ins**: varredura paginada da MikWeb → upsert idempotente em `whatsapp_contacts`;
  opt-out vence sempre; registro existente nunca é reativado. Cron diário + botão no painel com dry-run.
  **432 contatos, todos com opt-in.**

### ⚠️ Pendência manual (bloqueia métricas)
O webhook da instância na UazAPI precisa ter o evento **`messages` inscrito** (não só `messages_update`):
é por ele que chegam delivered/read e os cliques de botão. Sem isso, o funil mostra só "enviados" para sempre.

---

## 8. Cron (pg_cron + pg_net)

| Job | Schedule (UTC) | BRT | Função |
|---|---|---|---|
| `notify-sync-daily` | `0 11 * * *` | 08h00 | Régua → fila (`cron/notify-sync`) |
| `whatsapp-import-contacts-daily` | `30 10 * * *` | 07h30 | Reimporta opt-ins MikWeb |
| `notify-dispatch-5min` | `*/5 * * * *` | — | Dispatcher (envia a fila) |

- Jobs leem o secret do **Vault do banco** (`vault.decrypted_secrets`, name `cron_secret`,
  uuid `4264b601-c54f-41c7-9941-d5b6d360b481`), NÃO dos secrets da Edge Function.
  **Manter os dois sincronizados** — Vault esvaziado produziu 401 silencioso (pg_cron reporta
  "succeeded" mesmo com HTTP != 200; pg_net corta a espera em 5s mas a execução completa).

---

## 9. Estado de produção (conferido em 30/09/2026)

- Migrations 001–010 aplicadas e registradas; **011_referrals NÃO aplicada** (tabelas `referral_*` ausentes — conferido via `to_regclass`).
- Edge Function em produção é o commit **`50113ba`** (multi-conta): as rotas `/referrals/*`, `/public/referral*` e `/admin/referrals*` ainda respondem 404 "Rota não encontrada" (conferido por curl) — precisa `npm run deploy:functions` (código do commit `da4ccb8`).
- Canal WhatsApp: enabled, conectado, 432 opt-ins, régua ativa: `d_minus_3`, `due_day`, `late_1`, `late_5` (`late_10` off).
- `whatsapp_button_clicks`: 0 (aguarda webhook `messages` inscrito — ver §7).
- Push: 0 subscriptions (recurso existe e está testável, mas não é usado).
- Frontend: Vercel serve `dist/` — **deploy manual** (`npm run build` + publish) após cada mudança de UI; o build com as telas de indicações ainda não foi publicado.
- **Smoke tests pós-deploy**: `GET /api/public/referral-catalog` deve devolver `{"migrationPending":false,...}` (404 "Rota não encontrada" = função antiga ainda no ar);
  `GET /api/referrals/me` sem sessão deve devolver 401 "Sessão não encontrada";
  `GET /api/public/referral/ABCD2345` deve devolver 404 "Código de indicação não encontrado ou inativo".

---

## 10. Pendências e próximos passos

1. **URGENTE — credenciais em repo público**: rotacionar `MIKWEB_ADMIN_PASSWORD` e chaves VAPID;
   remover valores reais de `DEPLOY-SUPABASE.md` (usar placeholders e `supabase secrets set` como única fonte).
2. Confirmar inscrição do evento **`messages`** no webhook da instância UazAPI (§7) e validar um clique real chegando em `whatsapp_button_clicks`.
3. Decidir `daily_new_chat_cap` (hoje 1) — limita drasticamente o alcance diário da régua.
4. Frontend: deploy na Vercel do build atual (o funil só aparece no painel depois disso).
5. `README.md` está desatualizado (fala de Convex/stack antiga) — substituir pelo resumo deste handoff.
6. **Multi-conta MikWeb (29/09)**: cadastre a segunda conta em Conexões → "Adicionar conta"
   (a Conta A já foi migrada automaticamente). O sync varre as duas; falha de uma alerta o
   admin e segue com a outra. Ver `LEMBRETES-WHATSAPP.md` §13b.
7. **Indicações (30/09, commit `da4ccb8`) — próximo passo é SÓ deploy, código está pronto**:
   a) aplicar `011_referrals.sql` no SQL Editor (idempotente; conferir com `SELECT referral_random_code();`);
   b) `npm run deploy:functions`;
   c) smoke tests do §9 (catalog/me/referral code);
   d) `npm run build` + publish na Vercel (páginas `/indicacoes`, `/admin/referrals` e card do dashboard);
   e) criar as recompensas do catálogo em Painel → Indicações → Catálogo.
   Tudo destravado de uma vez: aviso WhatsApp na aprovação (template `referral.approved` editável em
   Mensagens), card de métricas no dashboard, catálogo, resgates e ajuste manual — a migration é o
   único bloqueio de todos eles. Enquanto ela não existir, os endpoints respondem 200 +
   `migrationPending: true` (o card do dashboard simplesmente não aparece; nunca 500).
8. **Fix da cota por cliente** (commit `3802a92`): entrega em `sending` se auto-barrava na contagem —
   cap 1 = 57 entregas presas em 30/09. `countRecentForCustomer` agora conta só sent/delivered/read e
   exclui a entrega em avaliação (`excludeDeliveryId`). Entra em produção junto do deploy da função (§10.7).
9. Ideias em aberto: taxas de conversão (%) no funil (com guarda para amostra pequena);
   reengajamento de quem clicou no Pix mas não pagou; relatório semanal consolidado; rate-limit/observabilidade do webhook;
   avisos WhatsApp para resgates (aprovado/aplicado/recusado); gráfico de evolução mensal no card de indicações.

---

## 11. Correções importantes já feitas (lições embutidas no código)

| Correção | Onde | Lição |
|---|---|---|
| Parser de status da UazAPI (`[object Object]` → unknown bloqueava envio) | `uazapi.ts` (commit `4ceb9fa`) | Resposta real tem `status` objeto na raiz + string aninhada; aceitar os formatos observáveis |
| Filtro de data MikWeb ("bug do zero falso") | `sources.ts` (`94a4cb0`) | Testado na seção 11 do check:notify |
| Sync com `no_customer` em silêncio (32/38 avisos sem cadastro) | `sources.ts` | Busca individual por ID (`/customers/{id}`) em lotes de 5 + fallback paginado; a listagem não cobre a base |
| Opt-out/cliques sem telefone | `webhook.ts` | Telefone pode vir aninhado em `message.chatid` (doc UazAPI) — fallback obrigatório |
| `integer out of range` na view de cliques | migration 007 | Literais `30*86400*1000` estouram int4 no Postgres |
| 401 silencioso do cron | Vault/DEPLOY-SUPABASE.md | pg_cron "succeeded" ≠ HTTP 200; secret tem que existir nos dois lugares |
| Nome indefinido no bundle da função | `check-edge-function.mjs` | esbuild não faz análise semântica; `typecheck:api` existe por isso (pegou bug no funil) |
| Idempotência de cliques | migration 007 + `webhook.ts` | Erro 23505 (duplicate key) = reentrega, vira `summary.ignored++` |

---

## 12. Suíte de testes (`scripts/check-notification-settings.mjs`)

316 verificações em 16 seções, rodando os módulos TS reais no Node (sem framework, sem banco — DB mocks por seção):
1 normalização do documento · 2 fingerprint · 3 persistência · 4 overrides · 5 janela no dispatcher ·
6 régua decide o template · 7 relatório carrega config · 8 painel/servidor concordam · 9 cota diária ·
10 sync régua→fila · 11 filtro de data MikWeb · 12 templates do editor · 13 botões de ação ·
14 cliques em botões (mock `makeWebhookDb`) · 15 funil de engajamento semanal ·
16 indicações (dedupe/payload/render do aviso de aprovação, template editável, métricas do card com fuso BRT).

Para acrescentar comportamento novo: nova seção numerada no fim, com mock mínimo; rode `npm run check:notify`
e `npm run verify:notify` antes de commitar. Convenção de dados: datas civis ISO, epoch ms para instantes, fuso UTC-3.

Suíte irmã `scripts/check-referrals.mjs` (`npm run check:referrals`, incluída no `verify:notify`): prova as
garantias plpgsql da migration 011 contra PGlite — crédito idempotente (unique parcial), débito atômico com saldo
nunca negativo, reembolso idempotente na recusa, máquina de estados do resgate, emissão de código. A migration 011
aplica sozinha: não depende de pgcrypto/uuid-ossp (código gerado por `random()` + alfabeto Crockford).
