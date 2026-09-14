# Deploy do Backend — Supabase Edge Function

O backend agora é uma Supabase Edge Function em `supabase/functions/api/index.ts`.

## 1. Login no Supabase CLI

Abre o terminal na raiz do projeto e executa:

```bash
npx supabase login
```

Você vai precisar de um **access token personalizado**. Obtém em:

1. https://supabase.com/dashboard/account/tokens
2. Clica em "New personal access token"
3. Nomeie (ex. "supernet-deploy") e copie o token

Cole o token no terminal que aparecer pedindo "Supabase Access Token" e aperte Enter.

## 2. Vincular ao projeto

O `<PROJECT_REF>` é o código do seu projeto. Encontra em:

- O project ref é `ssvwlbwsprjpfmevdnvb` — a URL do projeto é `https://ssvwlbwsprjpfmevdnvb.supabase.co`.

```bash
npx supabase link --project-ref ssvwlbwsprjpfmevdnvb
```

Se já estiver vinculado (porque a integração do Vercel gerou o `supabase/.temp` ou uma execução anterior fez link), pula este passo.

## 3. Configurar os secrets do backend

Substitui cada `...` e executa na raiz do projeto:

```bash
npx supabase secrets set \
  MIKWEB_ADMIN_PASSWORD='slackware@' \
  MIKWEB_API_URL='https://sua-mikweb.com.br/api' \
  MIKWEB_API_TOKEN='seu-token-aqui' \
  VITE_VAPID_PUBLIC_KEY='BB1rMYkRJJHdVuKWc4Ak-6nb-ugfDuRS9Reqgp9XYW_g2Z1bfcyb_FduPCIdh4GNz7cB6Mop--QrahaQjoZubvk' \
  VAPID_PRIVATE_KEY='l5a_M7FGWIpiYNLlhPoiGrZy3Jsadv5-_X42_9nnwwQ' \
  VAPID_SUBJECT='mailto:admin@minhasupernet.com'
```

Se não tiver as chaves VAPID ainda, gera com:

```bash
npx web-push generate-vapid-keys --json
```

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente
> pelo Supabase — não precisa defini-los manualmente.

## 4. Deploy da função

```bash
npm run deploy:functions
# equivalente a: npx supabase functions deploy api --no-verify-jwt
```

## Comandos extras úteis

```bash
# Ver os logs em tempo real
npx supabase functions logs api --follow

# Executar localmente (precisa do Docker Desktop, que nem sempre está disponível)
# nao eh necessario para deploy
```

## Cheque de produção

- [ ] Tabelas criadas no Supabase (SQL Editor → `supabase/migrations/001_initial_schema.sql`)
- [ ] Secrets configurados (passo 3)
- [ ] Edge Function deployada (passo 4)
- [ ] `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` disponíveis no Vercel (integração)
- [ ] `VITE_SUPABASE_URL` deve apontar para o projeto real: `https://ssvwlbwsprjpfmevdnvb.supabase.co`
- [ ] Deploy do frontend na Vercel

## Troubleshooting

Se o login falhar com "permission denied" ou "unauthorized":
- O token pode ter expirado — gere um novo em https://supabase.com/dashboard/account/tokens
- Ou faça logout primeiro: `npx supabase logout`

Se o `supabase link` falhar com "project already linked":
- Desvincula: `npx supabase unlink`
- Tenta novamente com o projeto correto
