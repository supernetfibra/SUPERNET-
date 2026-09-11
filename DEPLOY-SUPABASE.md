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
npx supabase link --project-ref <PROJECT_REF>
```

O `PROJECT_REF` é a parte inicial da URL do projeto: `https://<PROJECT_REF>.supabase.co`.

Alternativa: a integração Vercel↔Supabase já criou as variáveis no Vercel —
copie `SUPABASE_URL` de lá para descobrir o ref.

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

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente.

## 4. Deploy da função

```bash
npm run deploy:functions
# equivalente a: npx supabase functions deploy api --no-verify-jwt
```

## 5. Testar

```bash
# Health check
curl https://<PROJECT_REF>.supabase.co/functions/v1/api/version

# Login admin (deve retornar sessionToken)
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"slackware@"}'

# Login cliente teste
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/api/mikweb/login \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"12345678909","password":"1234"}'
```

## 6. Checklist produção

- [ ] Tabelas criadas no Supabase (SQL Editor → `supabase/migrations/001_initial_schema.sql`)
- [ ] Secrets configurados (passo 3)
- [ ] Edge Function deployada (passo 4)
- [ ] `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` disponíveis na Vercel (integração)
- [ ] Deploy do frontend na Vercel
- [ ] Login admin em `/login` com CPF `000.000.000-00` + senha `MIKWEB_ADMIN_PASSWORD`

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
