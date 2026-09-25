# Lembretes de faturas por WhatsApp (UazAPI) — estrutura proposta

> Status: **pré-implementação**. Este documento define a arquitetura antes de escrever
> código. As seções marcadas com 🔸 contêm decisões que precisam ser fechadas.
>
> ⚠️ **Revisado por `NOTIFICACOES-HUB.md`.** O lembrete de fatura é um *evento* do hub
> unificado de notificações (push + WhatsApp), não um pipeline próprio. Onde este
> documento dizia `whatsapp_messages` / `whatsapp_templates` / `whatsapp_reminder_rules`,
> valem as tabelas genéricas `notification_*` descritas em `NOTIFICACOES-HUB.md` §6.

## 1. Contexto atual (onde isso encaixa)

```
Navegador ─► Vercel (frontend estático)
     └────► Supabase Edge Function "api" (Hono, /api/*)
              ├── Postgres (sessions, config, auditoria, install_requests, push)
              ├── MikWeb API  → clientes, faturas, boletos
              ├── Web Push (VAPID)
              └── [NOVO] UazAPI → WhatsApp
```

Pecinhas que já existem e serão reaproveitadas:

| Já existe | Reuso para o lembrete |
| --- | --- |
| `getMikWebConfig()` (env → tabela → admin) | mesmo padrão para as credenciais UazAPI |
| `MikWebBilling` (`due_day`, `situation_name`, `url_boleto`, `pix_copy_paste_base64`) | corpo da mensagem e regra de disparo |
| `sendPushToSubs()` | mesma origem de evento: um `notify()` que fan-out para push + WhatsApp |
| `/admin/test-connection` | mesmo formato de teste de conexão para a UazAPI |
| `mikweb_audit_log` | trilha de auditoria dos envios |
| `src/lib/phone.ts` | normalização E.164 do celular |

## 2. Princípios de desenho

1. **Credencial só no backend.** `admintoken` e `token` da instância nunca chegam ao
   frontend (a doc da UazAPI é explícita: tudo que chega ao navegador é legível).
2. **Outbox pattern.** Nenhum envio acontece dentro do request do usuário. O que o
   usuário/admin faz é *enfileirar*; o dispatcher do hub entrega depois.
3. **Idempotência real no banco.** `track_id` da UazAPI *não* é chave de idempotência
   (aceita duplicatas). A garantia vem do hub, em dois níveis: `dedupe_key`
   (`billing:<id>:late_5`) para o evento e `UNIQUE(event_id, channel, target)` para
   a entrega.
7. **Um canal decide, o outro cobre.** Se o cliente não tem opt-in de WhatsApp, o
   lembrete sai por push em vez de ser descartado (modo `primary` do hub).
4. **Sem retry cego.** Timeout é resultado incerto: o envio pode ter saído. Retentativa
   só com reconciliação por `messageid`/webhook (política da própria doc).
5. **Revalidar antes de enviar.** Fatura paga entre o agendamento e o envio ⇒ cancela.
6. **Consentimento explícito + opt-out fácil.** 🔸 (ver §9)

## 3. Como usamos a UazAPI

Duas credenciais, dois escopos:

| Credencial | Header | Usamos para |
| --- | --- | --- |
| `admintoken` | `admintoken` | `POST /instance/create`, `GET /instance/list` |
| `token` da instância | `token` | `POST /send/text`, `POST /webhook`, `GET /instance/status`, `GET /instance/wa_messages_limits` |

Endpoints no escopo da v1:

- `POST /instance/create` `{name}` → devolve `token`
- `POST /instance/connect` `{}` → QR Code (ou código de pareamento com `phone`)
- `GET /instance/status` → `disconnected | connecting | connected | hibernated`
- `POST /send/text` `{number, text, delay, linkPreview, async, track_id}`
- `POST /send/media` → PDF do boleto (opcional, 🔸 §16)
- `GET /instance/wa_messages_limits` → cota de **novas conversas** e time-lock
- `POST /webhook` → receber `connection`, `messages`, `messages_update`

Detalhes que ditam o desenho:

- **Número no formato internacional, sem `+`, espaços ou pontuação** (`5511999999999`).
- **`delay`** com "digitando..." — usar delay aleatório para parecer humano.
- **`async: true`** empurra para a fila interna (bom para lote; ruim para rastrear).
- **Erro 463 / `WHATSAPP_REACHOUT_TIMELOCK`**: WhatsApp bloqueia temporariamente
  *iniciar novas conversas* por volume/qualidade. O `details` traz
  `new_chat_message_capping` (usado/total) e `reachout_timelock.until`.
  → o dispatcher precisa **pausar** quando isso aparecer, não insistir.
- **`429`**: respeitar `Retry-After`.
- **Webhook** deve ser rápido, deduplicar por id e tolerar ordem trocada.

Consequência de produto importante: **a primeira mensagem para um número que nunca
conversou conosco é a mais arriscada**. Por isso o opt-in acontece dentro do portal
(o cliente digita/confirma o número) e o volume diário de "novas conversas" é limitado.

## 4. Modelo de dados (migration `003_whatsapp_reminders.sql`)

```sql
-- Configuração da integração (espelha mikweb_config)
whatsapp_config(
  id, key UNIQUE DEFAULT 'default',
  base_url TEXT,              -- Server URL da UazAPI
  admin_token TEXT,           -- só backend
  instance_token TEXT,        -- só backend
  instance_name TEXT,
  enabled BOOLEAN DEFAULT false,
  daily_new_chat_cap INT DEFAULT 20,
  send_window_start INT DEFAULT 9,   -- hora local
  send_window_end   INT DEFAULT 20,
  paused_until BIGINT,        -- time-lock do WhatsApp
  last_status TEXT, last_checked_at BIGINT,
  updated_at BIGINT, updated_by TEXT
)

-- Ledger de consentimento
whatsapp_contacts(
  id, customer_id TEXT UNIQUE, cpf TEXT, customer_name TEXT,
  phone_e164 TEXT NOT NULL,
  opt_in BOOLEAN DEFAULT false, opt_in_at BIGINT, opt_out_at BIGINT,
  opt_in_source TEXT,          -- 'portal' | 'atendimento' | 'contrato'
  status TEXT DEFAULT 'active',-- active | blocked | invalid
  last_error TEXT, last_error_at BIGINT,
  created_at BIGINT, updated_at BIGINT
)

-- Regras de disparo (D-3, D0, D+1, D+5...) — produzem EVENTOS, não mensagens
notification_rules(
  id, key TEXT UNIQUE,         -- 'd_minus_3', 'due_day', 'late_5'
  event_key TEXT NOT NULL,     -- 'billing.due_soon' | 'billing.due_today' | 'billing.late'
  offset_days INT NOT NULL,    -- negativo = antes do vencimento
  active BOOLEAN DEFAULT true,
  sort_order INT
)

-- Templates: UM POR CANAL (push tem title; WhatsApp tem body longo)
notification_templates(
  id, channel TEXT, key TEXT, name TEXT,
  title TEXT, body TEXT,       -- {{nome}}, {{valor}}, {{vencimento}}, {{link}}, {{pix}}
  active BOOLEAN DEFAULT true,
  updated_at BIGINT,
  UNIQUE (channel, key)
)

-- OUTBOX UNIFICADA (push + WhatsApp) — detalhes em NOTIFICACOES-HUB.md §6
notification_events(        -- intenção: 1 linha por (fatura, regra)
  id, event_key, customer_id, cpf, dedupe_key UNIQUE, payload JSONB, priority, created_at
)
notification_deliveries(    -- entrega: 1 linha por (evento, canal, destino)
  id, event_id, channel, customer_id, cpf, target, rendered JSONB,
  status, attempts, scheduled_for, provider_id, error_key, error_message,
  sent_at, status_at, created_at,
  UNIQUE (event_id, channel, target)
)
notification_preferences(   -- 1 linha por cliente × canal
  id, customer_id, cpf, channel, enabled, opt_in_at, opt_out_at, source, updated_at,
  UNIQUE (customer_id, channel)
)

-- Com o hub, a idempotência deixa de ser "(fatura, regra)" e passa a ser:
--   dedupe_key = 'billing:<id>:late_5'  → protege o EVENTO
--   UNIQUE(event_id, channel, target)   → protege a ENTREGA

-- Dedupe de webhooks + opt-out
whatsapp_events(
  id, event_id TEXT UNIQUE, event_type TEXT, chat_id TEXT,
  phone_e164 TEXT, payload JSONB, received_at BIGINT
)
```

Além disso: **ALTER no `CHECK` de `mikweb_audit_log.type`** para aceitar
`whatsapp_sent`, `whatsapp_failed`, `whatsapp_opt_in`, `whatsapp_opt_out`
(o constraint inline herdou o nome `mikweb_audit_log_type_check`).

## 5. Pipeline (três estágios, desacoplados)

**A. Sync (1×/dia, ~06h)** — varre clientes/faturas em aberto na MikWeb e emite
`notify({key:'billing.due_soon', dedupeKey:'billing:1234:late_5', ...})` para cada
candidato. Quem decide canal, janela, cap e idempotência é o hub (ver
`NOTIFICACOES-HUB.md` §5) — aqui não há `if (temWhatsApp)`, isso é responsabilidade
do roteamento. Nada é enviado neste estágio.

**B. Dispatch (a cada 5–15 min)** — o dispatcher do hub pega um lote de
`notification_deliveries` com `status='queued'` e `scheduled_for` vencido via RPC com
`FOR UPDATE SKIP LOCKED` (evita envio duplicado com execuções concorrentes) e, para as
linhas de canal `whatsapp`, aplica as guardas específicas do canal:

```
opt-in ativo? ........................ não → skipped (e o push, se elegível, assume)
instância connected? ................. não → adia (reagenda +15min)
dentro da janela 9h–20h? ............. não → adia para próxima janela
time-lock/cota do WhatsApp estourou? . sim → pausa geral (paused_until) + alerta
fatura ainda em aberto na MikWeb? .... não → canceled
entrega duplicada p/ (evento,canal)? . sim → skipped
→ POST /send/text (delay aleatório 2–9s, linkPreview)
→ status 'sent', grava provider_id (messageid da UazAPI)
```

A revalidação da fatura é uma chamada MikWeb por envio — aceitável no volume de um
ISP; se virar gargalo, dá para revalidar em lote antes do lote.

**C. Webhook (`POST /api/webhooks/uazapi`)** — público, mas validado por secret na
query/header. Atualiza `delivered`/`read`/`failed`, captura "PARAR/SAIR/CANCELAR"
como opt-out (grava em `notification_preferences`), e eventos de `connection` para
marcar a instância caída. O webhook opera sobre `notification_deliveries`, igual aos
adapters — é o hub que recebe status, não o canal de WhatsApp em particular.

## 6. Regras default (a validar com a operação)

Estas são as regras de **bootstrap**: valem no primeiro dia e enquanto nada foi salvo
no painel. A partir do primeiro salvamento, a régua em vigor é a que está em
`notification_config` — editável em **Admin → Simulador** (§14b), com a origem
(`db`/`defaults`) e o fingerprint visíveis.

| key | quando | objetivo |
| --- | --- | --- |
| `d_minus_3` | 3 dias antes do vencimento | aviso + link do boleto |
| `due_day` | no dia do vencimento | lembrete leve |
| `late_1` | 1 dia após | aviso de atraso |
| `late_5` | 5 dias após | último aviso antes do bloqueio 🔸 |
| `late_10` | 10 dias após | desligada de propósito: só liga depois de validar `late_5` |

Cada regra para de disparar assim que a fatura é paga (revalidação do estágio B).

## 7. Formato da mensagem

Texto simples (sem template aprovado da Meta — é WhatsApp Web via UazAPI), com
placeholders resolvidos no backend:

```
Olá, {{nome}}! 👋
Sua fatura de {{referencia}} no valor de R$ {{valor}} vence em {{vencimento}}.
Pague pelo link: {{link}}
Pix copia e cola: {{pix}}

Qualquer dúvida, é só responder esta mensagem.
Para não receber mais lembretes, responda PARAR.
```

`{{link}}` = página de detalhe da fatura no portal (`/faturas/:id` — rota real do app;
exige login) e `{{boleto}}` = `url_boleto`/`integration_link`, que é o caminho de
pagamento que funciona sem sessão. `linkPreview: true` para o link renderizar bonito.
🔸 anexar o PDF via `/send/media` vs. só link (ver §15).

⚠️ A mensagem precisa ser **renderizada no momento do envio**, não no enfileiramento:
um aviso de atraso agendado para depois precisa contar os dias do dia em que sai.
O simulador já pegou esse erro (§"Simulador" abaixo).

## 8. Agendador 🔸

Três opções, mesma interface (endpoints internos + header `x-cron-secret`):

- **pg_cron + pg_net do Supabase** (menos peças móveis, mas roda dentro do banco)
- **GitHub Actions schedule** (repo já tem `.github/`)
- **cron externo / n8n** (mais fácil de ver e pausar pela operação)

Endpoints internos: `POST /api/cron/whatsapp-sync` e `POST /api/cron/whatsapp-dispatch`,
protegidos por secret próprio (a função é deployada com `--no-verify-jwt`).

## 9. Consentimento e LGPD 🔸

Fluxo recomendado: o cliente, logado no portal, cadastra/confirma o celular e marca
"aceito receber avisos por WhatsApp" (`opt_in_at`, `opt_in_source='portal'`). Isso
(a) atende LGPD, (b) resolve o maior risco operacional — a mensagem passa a ser
resposta a uma conversa iniciada pelo cliente, reduzindo o `new chat capping`.

Opt-out: palavra-chave no webhook + botão no portal + auditoria. A Privacy Policy
(`/privacidade`) precisa ganhar a cláusula de comunicação por WhatsApp.

## 10. Superfície de UI

- **Admin → Configurações**: bloco "WhatsApp (UazAPI)" com Base URL, admintoken,
  token da instância, botão *Testar conexão*, QR de conexão, status da instância,
  cota de novas conversas, liga/desliga geral, janela de horário, cap diário.
  Link *Ver o que sairia* → simulador (é o passo anterior a ligar o canal ativo).
- **Admin → Simulador** (`/admin/simulator`, §14b): o relatório dry-run sobre a base
  real ou sintética, com filtros por decisão/regra/cliente e comparação entre
  configurações. É também onde a **régua de lembretes** é editada e salva (§15b) — a
  cota continua em Configurações, porque é do canal. É a tela onde se decide o que
  sai, não onde se envia.
- **Admin → Lembretes**: fila (agendados/enviados/falhas), botão *enviar agora*,
  edição de regras e templates, métricas (enviados, entregues, lidos, falhas, opt-outs).
- **Portal do cliente → Perfil**: opt-in/opt-out do WhatsApp + confirmação do número.
- **Portal → Faturas**: botão "Receber esta fatura no WhatsApp" (dispara na hora).

## 11. Endpoints novos na Edge Function

```
-- específicos do canal WhatsApp
GET  /api/admin/whatsapp/config        POST /api/admin/whatsapp/config
POST /api/admin/whatsapp/test          GET  /api/admin/whatsapp/status
GET  /api/admin/whatsapp/qr            POST /api/admin/whatsapp/reconnect
POST /api/admin/whatsapp/contacts/opt-out

-- genéricos do hub (valem para push e WhatsApp)
GET  /api/admin/notifications/templates   POST /api/admin/notifications/templates
GET  /api/admin/notifications/rules       POST /api/admin/notifications/rules
GET  /api/admin/notifications/deliveries  POST /api/admin/notifications/send-now
GET  /api/admin/notifications/settings    POST /api/admin/notifications/settings   ✅ §15b
GET  /api/admin/notifications/simulate                                               ✅ §14
GET  /api/mikweb/notifications/prefs      POST /api/mikweb/notifications/prefs
POST /api/mikweb/notifications/send-billing

-- jobs internos
POST /api/cron/billing-sync               POST /api/cron/notify-sync      ✅ §15d
POST /api/cron/notify-dispatch            POST /api/webhooks/uazapi
```

> `/api/admin/push` e `/api/push/test` deixam de ter lógica de envio própria e passam
a ser chamadas do hub (`notifyAndWait`) — ver `NOTIFICACOES-HUB.md` §11.

## 12. Estrutura de arquivos

```
supabase/functions/api/
  index.ts            → só rotas (hoje tem 1440 linhas; extrair módulos)
  uazapi.ts           → cliente HTTP, mapa de erros, envio, status, QR (genérico de UazAPI)
  notify/             → o hub (ver NOTIFICACOES-HUB.md §13): hub, outbox, registry,
                        channels/push.ts, channels/whatsapp.ts
  notify/billing.ts   → produtor: faturas em aberto → eventos (estágio A)
  whatsapp/
    config.ts         → getWhatsAppConfig() (mesmo padrão do MikWeb)
supabase/migrations/003_notifications.sql
src/pages/AdminWhatsapp.tsx
src/pages/AdminNotifications.tsx
src/components/...
LEMBRETES-WHATSAPP.md
```

Já implementado (o simulador, §"Simulador" abaixo) usa estes arquivos:

```
supabase/functions/api/notify/
  model.ts        → primitivas puras: data civil, telefone, situação, valores
  rules.ts        → faturas → lembretes planejados (regras D-3/D0/D+1/D+5)
  templates.ts    → templates por canal + render com seções condicionais
  routing.ts      → cascata de decisão, cotas, projeção de escoamento
  simulate.ts     → runSimulation(): relatório dry-run (carrega a configuração usada)
  settings.ts     → configuração do pipeline: defaults, normalização, fingerprint
  settings-store.ts → lê/grava `notification_config` e aplica overrides do simulador
  demo-data.ts    → base sintética determinística + parser de snapshot
  sources.ts      → leitura da base real (MikWeb + Supabase), só leitura
scripts/simulate-reminders.ts   → aceita --settings <arquivo.json> (§15b)
scripts/check-edge-function.mjs → checa o index.ts, que nenhum tsconfig cobre

src/lib/simulator-report.ts   → apresentação do relatório (puro, testável)
src/pages/AdminSimulator.tsx  → a tela do simulador (§14b)
```
> Supabase Edge Functions suportam múltiplos arquivos com import relativo, então dá
> para tirar o WhatsApp de dentro do `index.ts` monolítico sem mudar o deploy.

## 13. Observabilidade e segurança

- Toda tentativa vira linha em `whatsapp_messages` + log em `mikweb_audit_log`.
- Nunca logar token, nunca retornar token ao frontend (só `ab12...ef90`, como já é feito
  com o token da MikWeb).
- Rate limit por cliente (não mais de 1 lembrete por fatura por dia).
- Backoff exponencial com jitter para `429/5xx`; **sem** retry automático de envio.
- Alerta (e pausa) quando a instância sai de `connected` ou o WhatsApp aplica time-lock.

## 14. Simulador (dry-run) — implementado

Antes de ligar qualquer envio, o pipeline inteiro roda em modo dry-run sobre a base
real, mostrando **o que sairia hoje, para quem, por qual canal e por que não para o
resto**. Nenhuma mensagem é enviada, nada é gravado, a UazAPI não é chamada.

```bash
npm run simulate                                  # cenário sintético realista
npm run simulate -- --scenario stress              # 5.000 clientes: testa a cota
npm run simulate -- --opt-in all                   # "e se todos aceitarem?"
npm run simulate -- --no-whatsapp                  # cobertura só com push
npm run simulate -- --instance-down --locked 3     # instância fora / time-lock
npm run simulate -- --already-sent                 # prova a idempotência
npm run simulate -- --settings config.json         # simula a régua salva no painel
npm run simulate -- --cap 50                       # override (o relatório marca)
npm run simulate -- --json > relatorio.json
npm run typecheck:notify                           # valida o núcleo e a CLI
npm run typecheck:api                              # nomes indefinidos no index.ts
npm run check:notify                               # invariantes da configuração (§15b)
npm run check:sql                                  # migrations contra Postgres real (§15c)
npm run verify:notify                              # tudo acima em sequência
```

O `config.json` é literalmente a resposta de `GET /api/admin/notifications/settings`
(salvar do navegador basta). Sem ele, a CLI usa a régua padrão e assume o canal ligado —
e as suposições da saída dizem isso.

Sobre a base real (a credencial da MikWeb só existe nos secrets do Supabase):

```
GET /api/admin/notifications/simulate?horizon=7&opt-in=auto&cap=20&reveal=1
                                    &source=mikweb|synthetic&whatsapp=on|off&instance=up|down
```

**Por que é confiável:** `runSimulation()` é uma função pura dos dados — recebe a base
já carregada e devolve o relatório. O mesmo código que decide em produção decide no
dry-run; a única diferença é que ninguém envia. Cada decisão vem com um motivo
(`skip_no_channel`, `defer_cap`, `fallback_push`, …), então o relatório explica a
*falta* de envio, não só o envio.

Duas distinções que o desenho das decisões carrega:

| Situação | Decisão | Porque |
| --- | --- | --- |
| sem opt-in, sem celular, WhatsApp desligado | `fallback_push` / `skip_no_channel` | bloqueio **estrutural**: o canal não existe para esse cliente |
| instância caída, time-lock, fora da janela, cota estourada | `defer_locked` / `defer_window` / `defer_cap` | bloqueio **transitório**: mantém o canal e adia — trocar de canal por cota estourada seria pior |

### O que a primeira rodada já mostrou

Números do cenário `realistic` (400 clientes, 578 faturas, base sintética):

1. **Fatura com mais de 12 dias de atraso nunca é lembrada**: 165 das 414 faturas em
   aberto ficam fora do alcance das regras atuais. É decisão de negócio, não bug —
   ligar `late_10`/um aviso mensal, ou aceitar que a régua para no 5º dia. A
   alternativa (disparo retroativo em massa) é justamente o que não se deve fazer.
2. **A cota de novas conversas é o gargalo real**, não o texto nem a API: com 20/dia,
   `--opt-in all` espalha a fila por ~12 dias, e no cenário de 5.000 clientes por
   ~341 dias. Sem essa projeção, a conta só apareceria como bloqueio do WhatsApp em
   produção.
3. **Começar só com opt-in custa cobertura**: 90 de 267 candidatos ficam sem nenhum
   canal (`skip_no_channel`). `--no-whatsapp` derruba de 165 para 94 avisos, o que
   mede o valor do push como fallback.
4. **A idempotência segura a repetição**: `--already-sent` marca os avisos já
   entregues e nenhum deles reaparece como envio.

### O que o simulador ainda não sabe

Tudo o que ele não conseguiu ler aparece em `assumptions` no relatório, nunca
implícito: cota de novas conversas (usada a do config, não a de
`/instance/wa_messages_limits`), histórico de conversas, opt-in (a tabela de
consentimento ainda não existe — daí `opt-in=all` para o cenário otimista) e, na
estratégia por cliente, o fato de ser **uma amostra** (`truncated: true`).

## 14b. Simulador na tela do admin — implementado

`/admin/simulator` (`src/pages/AdminSimulator.tsx`) consome o endpoint de §14 e mostra o
relatório sem que ninguém precise de terminal:

- **Reporte inteiro**: enviados (WhatsApp/push), adiados, ignorados, novas conversas,
  candidatos; faturas por situação; alcance (opt-in, celular válido, push); canal
  (instância, janela, cota, time-lock); projeção de escoamento da cota.
- **A configuração vem do painel, não do código** (§15b): os campos nascem do
  `GET /admin/notifications/settings` e, quando algo difere do que está salvo, a tela
  avisa (*"Esta rodada não é o que está salvo"*) e lista os overrides. Rodar sem mexer
  em nada simula exatamente o que será enviado — com o fingerprint à vista.
- **Régua editável e salvável**: tabela de regras (ligada, chave, evento, deslocamento
  em dias, prioridade, rótulo), *Adicionar regra*, *Régua padrão* (carrega o documento
  padrão do código para comparar) e *Salvar régua* → `POST /notifications/settings`. A
  regra deslocada só é salva com validação: chave duplicada ou offset fora de -60..60
  bloqueiam o botão antes de virar comportamento.
- **Configuração como formulário**: fonte, cenário, data de referência, horizonte, hora,
  cota de novas conversas, cota por cliente, opt-in, push, canal ligado/desligado,
  instância conectada ou não, time-lock, clientes varridos, itens do relatório,
  mensagens renderizadas, revelar telefone. Nada é enviado nem gravado.
- **Comparar configurações, não só rodar**: *Fixar como referência* guarda o relatório e
  cada rodada seguinte mostra o delta por métrica e a lista de parâmetros alterados.
  Sem isso, mudar a cota de 20 para 50 seria um número solto (e o simulador mostra que,
  na base atual, isso vale **+1 aviso** — a cota adia, não entrega mais).
- **Filtros por decisão, regra, nome/CPF/referência**, e cada linha abre a mensagem
  renderizada exata que sairia.
- **Suposições visíveis**: o que a simulação não conseguiu ler aparece na própria tela,
  não escondido no JSON.

Duas regras de apresentação que moram em `src/lib/simulator-report.ts` (módulo puro,
separado da tela porque é onde se erra fácil):

1. **Chips e filtros contam pelos ITENS, não pelo resumo.** Num relatório truncado,
   `byDecision`/`byRule` contam a janela inteira; um filtro construído a partir deles
   ofereceria "late_1 (300)" e mostraria zero linhas.
2. **Prévia ausente quase nunca significa "não sairia".** Item adiado carrega
   `channel: whatsapp` sem prévia, e aviso que sai pode ficar sem prévia quando o
   orçamento de renderização (`preview-limit`) acaba. A decisão é checada antes do canal
   para a tela não mentir sobre o que sairia.

## 15. Envio real — implementado

O caminho de envio existe e passa **inteiro** pela outbox. Arquivos:

```
supabase/functions/api/notify/
  uazapi.ts              → cliente HTTP: /send/text, /instance/status, /connect,
                            /instance/wa_messages_limits, mapa de erros (463, 429, 401)
  outbox.ts              → enqueue, claim, release, status, listagem
  dispatch.ts            → drena a fila: re-render no envio, backoff, time-lock
  channel.ts             → contrato de canal (push entra depois sem tocar no dispatcher)
  channels/whatsapp.ts   → adapter sobre o cliente UazAPI
  send-billing.ts        → caso de uso do botão "enviar lembrete" (prévia + envio)
  config.ts              → credenciais (env > tabela) e cota/janela
  settings.ts            → régua/horizonte/hora: defaults, validação, fingerprint (§15b)
  settings-store.ts      → persistência em `notification_config` + overrides do simulador
  runtime.ts             → composição (expõe getSettings/saveSettings)
  webhook.ts             → status de entrega e opt-out
  reach.ts               → alcance por canal (opt-in, celular, conversa existente):
                            a MESMA leitura para o simulador e para o sync
  sync.ts                → estágio de sync: régua → eventos na outbox (cron diário)
supabase/migrations/003_notifications.sql
supabase/migrations/004_notification_settings.sql
supabase/migrations/005_new_chat_quota.sql
src/components/ConfirmDialog.tsx
```

Rotas novas: `GET|POST /api/admin/whatsapp/config`, `POST /api/admin/whatsapp/connect`,
`POST /api/admin/whatsapp/test`, `POST /api/admin/notifications/send-now`,
`GET /api/admin/notifications/deliveries`, `POST /api/cron/notify-dispatch`,
`POST /api/webhooks/uazapi`.

### As garantias, e onde cada uma mora

| Garantia | Onde é imposta |
| --- | --- |
| Não enviar duas vezes a mesma cobrança | `dedupe_key` único + `UNIQUE(event_id, channel, target)`; enqueue e claim são funções no banco, não checagem no app |
| Dois dispatchers não pegam a mesma entrega | `FOR UPDATE SKIP LOCKED` no `claim_notification_deliveries` |
| O texto sai com a data do **dia do envio** | `renderAtSendTime()` recalcula `dias_atraso` / `dias_para_vencer` |
| Um só caminho de envio | o botão do painel enfileira e chama o **mesmo** `dispatchQueue({ ids })`; não existe `sendMessage()` paralelo |
| Timeout não vira mensagem duplicada | desfecho `uncertain` → falha marcada, sem retry automático |
| Time-lock não vira mais bloqueio | erro 463 → `paused_until` na config e o lote inteiro é reagendado |
| Não cobrar fatura paga | `sendBillingReminder()` recusa situação diferente de "em aberto" — a UI só esconde o botão |
| Não afirmar atraso antes da hora | `scheduleMismatch()` reagenda atraso para depois do vencimento e descarta aviso de vencimento já vencido |
| Não receber mensagem após "PARAR" | webhook grava `opt_out_at`, que vence o `opt_in` na leitura |
| A régua que o simulador mostra é a que agenda | simulador e dispatcher leem o mesmo `NotificationSettings`; o relatório leva o `fingerprint` (§15b) |
| Não enviar fora do horário comercial | `dispatchQueue()` consulta a janela da configuração antes de reservar; `manual` passa por cima |
| Não estourar a cota diária de novas conversas | `reserve_new_chat_slot()` (migration 005): reserva com `pg_advisory_xact_lock` por canal antes do envio; barrado volta para a fila sem gastar tentativa |
| Configuração quebrada não vira disparo errado | `normalizeDocument()` esvazia régua inválida com nota, em vez de "consertar" com o padrão |

`attempts` é incrementado no `claim`, mas `release()` o desfaz: reagendar por cota ou
time-lock não é tentativa falhada — senão um cliente barrado pela cota esgotaria as
tentativas sem nunca ter falhado.

### Como ligar (na ordem)

1. Aplicar `003_notifications.sql`, `004_notification_settings.sql` e
   `005_new_chat_quota.sql` no SQL Editor, nessa ordem. A 005 corrige, de passagem, o
   `enqueue_notification` da 003 (ver §15c e `DEPLOY-SUPABASE.md` §6).
2. Configurar os secrets (ou preencher pela tela) — ver `DEPLOY-SUPABASE.md` §3.1.
3. Painel → **Configurações → Lembretes por WhatsApp**: salvar credenciais →
   *Conectar (QR)* → *Testar canal* → *Enviar teste* para o seu próprio número.
4. Ligar o switch **Canal ativo**.
5. Apontar o webhook da UazAPI para `…/api/webhooks/uazapi?secret=…` e agendar
   `POST …/api/cron/notify-dispatch` a cada 5–15 min com `x-cron-secret`.
6. Só então usar o botão **Lembrar** no painel, fatura a fatura (ou ligar o automático,
   item 7).
7. **Automático** (§15d): agendar `POST …/api/cron/notify-sync` **uma vez por dia**, de
   preferência antes da janela abrir (ex.: 8h). Sem esse cron não existe pipeline
   automático; com ele, cada dia enfileira os avisos do próprio dia e o cron de dispatch
   (item 5) entrega. Conferir antes com `…/cron/notify-sync?dryRun=1`.

## 15b. Configuração persistida: a régua e as cotas saem do código

O problema que esta seção resolve: **o simulador e o dispatcher podiam ler coisas
diferentes**. A régua vivia em `DEFAULT_RULES` (código) e as cotas do simulador vinham
de parâmetros de URL com default também no código — então um relatório "sem override
nenhum" ainda podia divergir do que sairia de verdade.

Agora existe **um objeto** (`NotificationSettings`) e uma única porta de entrada para
ele: `normalizeDocument()` em `notify/settings.ts`. Linha do banco, corpo do POST,
arquivo lido pela CLI e defaults do código passam todos pela mesma normalização.

### Dois donos, de propósito

| Chave | Onde mora | Quem edita |
| --- | --- | --- |
| régua, horizonte, hora de execução, base do portal | `notification_config.settings` (JSONB) | Admin → Simulador → *Salvar régua* |
| cota de novas conversas, cota por cliente, janela, ligado/desligado | `whatsapp_config` | Admin → Configurações → WhatsApp |

Um dono por chave: editar a cota não pode sobrescrever a régua por acidente. A cota é
lida **pelo mesmo** `getWhatsAppConfig()` que o dispatcher usa — não há um segundo
leitor de `whatsapp_config` que possa divergir.

### O que faz "simulado = enviado" ser verificável

1. **A rodada padrão não manda nada.** Na tela, um parâmetro de configuração só vai
   na query quando **difere** do que está salvo. Ausente no backend significa "use a
   configuração persistida". Rodar sem mexer em nada é, literalmente, o pipeline.
2. **O relatório carrega a configuração inteira** em `report.settings`, com
   `fingerprint` (`s1-xxxxxxxx`) e procedência (`db` ou `defaults`). Guardar o JSON da
   simulação guarda o que ela usou — não depende da memória de quem rodou.
3. **Desvio é declarado.** Toda sobreposição aparece em `report.overrides` (ex.:
   `cota de novas conversas 20 → 50`), com o texto gerado pelo mesmo `applyOverrides()`
   no servidor e no painel. Enquanto não for salvo, o envio real segue o que está salvo.
4. **Salvar fixa.** Com `origin: defaults`, um deploy pode mudar a régua em vigor (o
   padrão é do código). Salvar grava o documento efetivo em `notification_config` e
   passa a `origin: db`. Enquanto não salvar, a tela diz isso em voz alta.

⚠️ A validação nunca "conserta" com a régua padrão: documento presente mas quebrado
(chave inválida, offset não numérico) vira régua **vazia** com nota — não envia nada
errado ao cliente. Régua vazia é uma pausa legítima; o painel avisa quando nenhuma
regra está ligada.

### A janela de envio passou a valer em produção

O `dispatchQueue()` agora lê `window` da configuração: fora da janela, nada é reservado
e as entregas continuam na fila (o próximo cron pega quando abrir). Sem isso, o
`defer_window` existia só no relatório. A política `manual` (o botão *Lembrar*) ignora
a janela de propósito — a decisão de um humano é dele.

### A cota diária de novas conversas passou a valer em produção (§15c)

Era a última divergência entre relatório e envio: `newChatCapPerDay` existia no
simulador desde o começo e não era aplicado em lugar nenhum. O teto de conversas novas
era, na prática, o time-lock do WhatsApp — ou seja, o estouro aparecia **depois** de
acontecer, como restrição do número. Agora o dispatcher reserva a vaga **antes** de
falar com o provedor.

| Cota | Do que protege | O que `manual` faz |
| --- | --- | --- |
| Por cliente/dia | a caixa de entrada de uma pessoa | **passa por cima** — o humano decidiu que aquela fatura merece o aviso agora |
| Novas conversas/dia | o **número** contra restrição do WhatsApp | **não passa** — "enviar agora" não é motivo para arriscar o canal inteiro (o time-lock também vale nos dois modos) |

A vaga é reservada por `reserve_new_chat_slot()` (migration 005), que roda dentro de uma
transação com `pg_advisory_xact_lock` por canal. Não é zelo: contagem de cota é
*check-and-set*, e dois crons sobrepostos — ou o cron junto do botão do painel — leriam
o mesmo número e os dois passariam do teto. Verificação no app corre; lock no banco, não.

As regras, todas espelhando o simulador:

- **conversa nova** = nenhum envio bem-sucedido anterior para aquele destino. Quem já
  recebeu uma mensagem não consome vaga;
- **o dia é o dia civil local** (`civilDayStartMs`, UTC-3), o mesmo do relatório. Por isso
  o webhook de hoje não arrasta para hoje um envio de ontem (`COALESCE(sent_at, status_at)`);
- **cota 0 significa sem teto** (igual ao simulador, que só aplica quando o valor é > 0),
  e a contagem continua acontecendo;
- **barrado não é falha**: a entrega volta para a fila no início da próxima janela, sem
  consumir tentativa (`release()` desfaz o `attempts` do claim). O resumo do cron traz
  `newChats: { cap, started, heldByCap, usedToday }`, que é o número para comparar com o
  `deferredByCap` do relatório;
- **reenvio do mesmo aviso não consome uma segunda vaga** — senão uma falha transitória
  de rede cobraria a cota duas vezes pela mesma conversa;
- **migration pendente não para a fila**: sem a função no banco, o envio segue (fail-open)
  e o resumo declara `newChats.error` em vez de mentir que a cota foi aplicada.

🔸 **O que segue divergente (de propósito):** o simulador descarta um aviso adiado além
de 45 dias (ou mais de 5 dias no caso de atraso), `skip_superseded`. O dispatcher adia
para o dia seguinte quantas vezes forem necessárias. Com cota muito apertada e fila
grande, é possível que um lembrete saia semanas depois, com o número de dias de atraso
correto — enquanto o relatório dizia que ele seria descartado. Fechar isso exige levar
`ruleOffsetDays` até o dispatcher (hoje só o payload do evento viaja).

### Endpoints

```
GET  /api/admin/notifications/settings   → régua + canal + fingerprint + origem + defaults
POST /api/admin/notifications/settings   → salva régua/horizonte/hora (documento parcial)
```

O `POST` aceita documento parcial (mandar só `horizonDays` não apaga a régua), rejeita
tipo errado com 400 (bug de cliente não é configuração a corrigir) e devolve as notas
do que precisou ser limitado — além de registrar `notification_config` na auditoria.

## 15d. Sync: a régua vira fila — implementado

Era o que faltava para o pipeline existir **sem o painel**: até aqui alguém clicava
*Lembrar* em cada fatura. Agora `POST /api/cron/notify-sync` lê a base, planeja e
enfileira os eventos do dia no outbox; o cron de dispatch (§15) entrega. O módulo é
`notify/sync.ts`; o alcance (opt-in + celular + histórico de conversa) vem de
`notify/reach.ts`, extraído para o simulador e o sync lerem a **mesma** regra.

### A fronteira: quem decide o quê

| Decisão | Quem toma |
| --- | --- |
| quais avisos pertencem a este dia, para quem, com qual texto | **sync** (planejamento puro: `rules.ts` + `reach.ts` + `templates.ts`) |
| cota, janela, time-lock, ordem de fila, tentativas | **dispatcher**, na hora de enviar |

Se o sync também aplicasse cotas existiriam dois lugares decidindo o mesmo, e o relatório
voltaria a mentir sobre o envio — exatamente o que as §15b–§15c fecharam. O sync planeja; o
dispatcher julga.

### Por que um dia, e não o horizonte inteiro

O padrão é `days: 1`: enfileira só os avisos **de hoje**. Não é timidez. Entre enfileirar e
enviar, o cliente pode **pagar a fatura** — e o dispatcher não relê a situação (ele só tem o
payload do evento). Enfileirando o dia, a janela de risco é de horas; enfileirando o
horizonte, seria de dias. `days` > 1 existe para recarga deliberada, com o risco na mão de
quem pede.

🔸 **O que isso deixa em aberto:** ainda é possível lembrar uma fatura paga na mesma manhã
(paga às 9h05, aviso às 9h10). Fechar de vez exige o dispatcher reconferir a situação da
fatura antes de enviar — uma consulta à MikWeb no caminho do envio, com cache e circuito
próprio. É o próximo passo natural, e o motivo de o padrão ser `days: 1`.

### Duas armadilhas que a implementação trata

1. **A varredura não é "as faturas de hoje".** A régua padrão tem `d_minus_3`: o aviso de
   hoje é de uma fatura que **ainda vai vencer**. `syncDueWindow()` traduz a régua em janela
   de vencimento (`[from − maxOffset, to − minOffset]` → os 7 dias de hoje viram
   `2026-09-18…2026-09-26`). Varrer só o vencimento de hoje perderia o aviso mais valioso.
2. **Canal desligado bloqueia o lote inteiro**, em vez de encher a fila. Uma fila que
   acumula enquanto o canal está off vira rajada retroativa no dia em que alguém liga o
   switch — precisamente o que §6 chama de "não fazer".

### O que o sync recusa a enfileirar, e como declara

Todo aviso planejado cai em **um** balde do resumo (`plan.skipped`), com o motivo:

| Motivo | Quando |
| --- | --- |
| `channel_disabled` | canal desligado (bloqueia o lote) |
| `no_customer` | o cadastro do cliente não veio na varredura — não há como montar o texto |
| `already_enqueued` | já existe evento com esta chave |
| `no_template` | sem template ativo para o evento |
| `no_opt_in` | sem autorização de WhatsApp e sem push |
| `invalid_phone` | tem opt-in, mas o número não é celular válido (o `detail` diz se é fixo ou ausente) |
| `push_pending` | só teria destino por push — o adapter ainda não foi migrado (fase –1) |
| `no_channel` | nem WhatsApp nem push |

`push_pending` vence `no_opt_in`/`invalid_phone` de propósito: é a informação acionável
("estes avisos passariam a sair quando o push entrar"), e no cenário realista são **3 dos
27** avisos do dia.

### Idempotência em duas camadas

A chave é a do planejamento (`billing:<id>:<regra>`) — a mesma do relatório. A lista de
chaves já existentes evita a chamada desnecessária ao banco; e o `enqueue_notification`
recusa a segunda de verdade. A segunda camada não é zelo: a leitura é limitada a 5000
linhas (`sources.ts`), então uma base antiga pode ter chaves fora da lista.

### O que o resumo do cron traz

`day`, `dueWindow`, `settings.fingerprint` (a régua que enfileirou, auditável),
`source` (quanto foi lido), `plan.byRule` + `plan.skipped`, `enqueued`, `duplicates`,
`blocked`, `assumptions` e os itens com preview do texto. Em `dryRun=1` nada é gravado —
é a conferência do dia antes de deixar o cron rodar sozinho.

E a verificação que fecha o desenho: com cotas neutralizadas (para isolar o planejamento),
o conjunto que o sync enfileira é **exatamente** o conjunto que o simulador descreve como
`send_whatsapp` para o mesmo dia e a mesma base (`check:notify` §10).

## 16. Fases de entrega

As fases abaixo pressupõem a **Fase 0 do hub** (`NOTIFICACOES-HUB.md` §14): as tabelas
`notification_*`, o hub e o adapter de push migrados. A partir daí, o WhatsApp é um
adapter novo — não um segundo pipeline.

| Fase | Entrega | Valor isolado |
| --- | --- | --- |
| –2 | ✅ **Simulador dry-run** (§14) + tela no admin (§14b) | valida as regras sem enviar nada |
| –2.5 | ✅ **Configuração persistida** (§15b): régua em `notification_config`, cotas lidas do canal, fingerprint no relatório, janela imposta no dispatcher | o que é simulado passa a ser o que é enviado |
| –2.6 | ✅ **Cota diária de novas conversas** (§15c): reserva atômica no banco antes do envio, com a mesma regra do simulador | o número deixa de depender do time-lock para saber quando parar |
| –2.7 | ✅ **Sync** (§15d): cron diário enfileira os avisos do dia a partir da base real | o pipeline passa a rodar sem o painel |
| –1 | Hub + adapter push migrados (`/admin/push`, `/push/test`) | histórico e dedupe no canal que já existe |
| 0 | ✅ Instância UazAPI, config no admin, teste de conexão e de envio | prova que o canal funciona |
| 1 | ✅ Adapter WhatsApp + outbox + botão "enviar lembrete" com prévia | envio sob demanda, sem automação |
| 2 | Sync de faturas → eventos (régua persistida) + dispatcher agendado + cota diária de novas conversas imposta no envio | lembrete automático |
| 3 | Webhook (status, opt-out) + painel unificado de entregas | operação visível |
| 4 | PDF/mídia, Pix, botões interativos, múltiplas instâncias | refinamento |

## 17. Decisões em aberto 🔸

1. **Escopo do primeiro disparo**: só opt-in confirmado, ou todos os clientes ativos
   com celular (com opt-out por palavra-chave)?
2. **Agendador**: pg_cron, GitHub Actions ou cron externo/n8n?
3. **Conteúdo**: texto + link, ou texto + PDF anexo, ou texto + Pix copia-e-cola?
4. **Instâncias**: um único número para toda a base, ou um por filial/grupo de clientes?
5. **Regra `late_5`**: existe aviso de bloqueio ao cliente hoje? O texto precisa alinhar.
