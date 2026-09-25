# Deploy do Backend — Supabase Edge Function

O backend agora roda como uma **Supabase Edge Function** (`api`), não mais na Vercel.
A Vercel serve apenas o frontend estático (Vite).

## 1. Login no Supabase CLI

```bash
npx supabase login
# Cole o access token gerado em https://supabase.com/dashboard/account/tokens
```

## 2. Vincular o projeto (uma única vez)

```bash
npx supabase link --project-ref ssvwlbwsprjpfmevdnvb
```

O project ref é `ssvwlbwsprjpfmevdnvb` — a URL do projeto é `https://ssvwlbwsprjpfmevdnvb.supabase.co`.

## 3. Configurar os secrets do backend

```bash
npx supabase secrets set \
  MIKWEB_ADMIN_PASSWORD='slackware@' \
  MIKWEB_API_URL='https://sua-mikweb.com.br/api' \
  MIKWEB_API_TOKEN='seu-token' \
  VITE_VAPID_PUBLIC_KEY='BB1rMYkRJJHdVuKWc4Ak-6nb-ugfDuRS9Reqgp9XYW_g2Z1bfcyb_FduPCIdh4GNz7cB6Mop--QrahaQjoZubvk' \
  VAPID_PRIVATE_KEY='l5a_M7FGWIpiYNLlhPoiGrZy3Jsadv5-_X42_9nnwwQ' \
  VAPID_SUBJECT='mailto:admin@minhasupernet.com'
```

### 3.1. Secrets do WhatsApp (opcional)

Só necessários se for usar os lembretes por WhatsApp. Têm prioridade sobre o que
for salvo no painel admin (aba **Configurações → Lembretes por WhatsApp**):

```bash
npx supabase secrets set \
  UAZAPI_BASE_URL='https://sua-instancia.uazapi.com' \
  UAZAPI_INSTANCE_TOKEN='token-da-instancia' \
  UAZAPI_ADMIN_TOKEN='admintoken' \
  UAZAPI_WEBHOOK_SECRET='um-segredo-aleatorio' \
  CRON_SECRET='outro-segredo-aleatorio'
```

> `UAZAPI_INSTANCE_TOKEN` (header `token`) envia mensagens e lê status.
> `UAZAPI_ADMIN_TOKEN` (header `admintoken`) cria e lista instâncias.
> Nenhum dos dois chega ao navegador — o frontend só fala com a Edge Function.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente.

## 4. Deploy da função

```bash
npm run deploy:functions
# equivalente a: npx supabase functions deploy api --no-verify-jwt
```

## 5. Testar

```bash
# Health check
curl https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/version

# Login admin (deve retornar sessionToken)
curl -X POST https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"slackware@"}'

# Login cliente teste
curl -X POST https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/mikweb/login \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"12345678909","password":"1234"}'
```

## 6. Checklist produção

- [ ] Tabelas criadas no Supabase (SQL Editor → `supabase/migrations/001_initial_schema.sql`)
- [ ] Migration de notificações aplicada (`supabase/migrations/003_notifications.sql`)
- [ ] Migration da configuração aplicada (`supabase/migrations/004_notification_settings.sql`)
- [ ] Migration da cota de novas conversas aplicada (`supabase/migrations/005_new_chat_quota.sql`)
      — ela também **re-aplica o `enqueue_notification`**: a versão da 003 falhava em
      tempo de execução (`column reference "event_id" is ambiguous`) e o Supabase não
      re-executa migration já aplicada. Se a 003 já foi aplicada, é a 005 que corrige
- [ ] **Régua salva no painel** (Admin → Simulador → *Salvar régua*): enquanto nada for
      salvo, a régua em vigor é a padrão do código e o simulador mostra `origin: defaults`
- [ ] Secrets configurados (passos 3 e 3.1)
- [ ] Webhook da UazAPI apontando para `https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/webhooks/uazapi?secret=$UAZAPI_WEBHOOK_SECRET`
- [ ] Cron chamando `POST .../api/cron/notify-dispatch` com o header `x-cron-secret` (a cada 5–15 min)
- [ ] Cron chamando `POST .../api/cron/notify-sync` com o header `x-cron-secret` (**uma vez por
      dia**, antes da janela abrir — ex.: 8h para a janela 9h–20h). Sem ele não existe envio
      automático: quem enfileira é o painel. Conferir primeiro com `?dryRun=1`, que planeja e
      responde o que seria enfileirado, sem gravar nada
- [ ] Edge Function deployada (passo 4)
- [ ] `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` disponíveis na Vercel (integração)
- [ ] `VITE_SUPABASE_URL` deve apontar para o projeto real: `https://ssvwlbwsprjpfmevdnvb.supabase.co`
- [ ] Deploy do frontend na Vercel
- [ ] Login admin em `/login` com CPF `000.000.000-00` + senha `MIKWEB_ADMIN_PASSWORD`

## 7. Verificações antes de subir

A Edge Function (`supabase/functions/api/index.ts`) importa de `esm.sh` e por isso
**não entra em nenhum `tsconfig`** — nada a checava até agora. Os três comandos
abaixo cobrem tudo que pode quebrar no deploy:

```bash
npm run verify:notify      # roda os quatro abaixo em sequência (o portão único)
npm run typecheck:notify   # núcleo puro dos lembretes + CLI do simulador (tsc strict)
npm run typecheck:api      # empacota a Edge Function e procura nome indefinido
npm run check:notify       # configuração persistida, cotas e sync (131 verificações)
npm run check:sql          # as migrations contra um Postgres de verdade (30 verificações)
npm run build              # typecheck do frontend + build do Vite
```

O `check:notify` roda os módulos TS direto no Node (sem build) e cobre o que erra fácil
e em silêncio na configuração: documento parcial preservando a régua salva, fingerprint
estável, janela de envio respeitada pelo dispatcher, cota diária de novas conversas
reservada antes do envio e o painel concordando com o servidor sobre o que é override.

Na parte do sync (§15d do `LEMBRETES-WHATSAPP.md`), os dois lados são comparados: rodando
o planejamento do sync e o do simulador sobre a **mesma base**, o conjunto enfileirado tem
de ser exatamente o conjunto que o relatório descreve como `send_whatsapp` para o dia.

O `check:sql` é o único que executa SQL: sobe um Postgres em WebAssembly (PGlite, sem
Docker), aplica as migrations 003 → 005 na ordem e exercita as garantias que moram em
plpgsql. Ele já se pagou — foi assim que apareceu o erro em `enqueue_notification`
(descrito no checklist acima), que nenhum typecheck pegaria e que só surgiria na
primeira fatura enviada. Se o PGlite não estiver instalado, o script avisa e sai sem
falhar (`npm i -D @electric-sql/pglite`).

O `typecheck:api` roda o mesmo `esbuild` do deploy e depois `tsc --checkJs` no bundle,
procurando apenas "nome não definido" (`Deno` é global do runtime e é ignorado). Isso
não é zelo abstrato: nesta base, renomear um parâmetro de configuração deixou uma
referência órfã no `index.ts` e o `esbuild` empacotou normalmente — o erro só
apareceria em produção.

O `check:notify` existe pelo mesmo motivo, no outro lado: a configuração persistida tem
falhas que não doem no typecheck (documento parcial revertendo a régua, override não
declarado no relatório).

Para conferir as regras sem enviar nada:

```bash
npm run simulate                       # cenário sintético
npm run simulate -- --settings cfg.json  # simula a configuração salva no painel
```

## Como funciona

```
Navegador ──► Vercel (frontend estático: HTML/JS/CSS + sw.js)
     │
     └──► fetch(VITE_SUPABASE_URL/functions/v1/api/...)
              │
              ▼
          Supabase Edge Function (Hono)
              │
              ├── Supabase Postgres (sessões, auditoria, config, solicitações)
              ├── MikWeb API (clientes, faturas, boletos)
              └── Web Push (VAPID)
```

Sessões via headers (`x-session-token` / `x-admin-token`) — cookies não são
enviados cross-origin, por isso o frontend guarda o token no localStorage.
