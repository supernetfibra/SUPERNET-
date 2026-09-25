# Hub de notificações — fan-out para Web Push e WhatsApp

> Documento de design. Complementa `LEMBRETES-WHATSAPP.md`: o lembrete de fatura é
> **um evento** neste hub, não um pipeline próprio.
>
> Padrão de reuso: **uma intenção semântica → N canais**. Nenhum canal conhece
> fatura; nenhum produtor conhece canal.

## 1. Por que existe (estado atual)

Hoje o push é enviado direto, dentro do request:

| Onde | Como | Problema |
| --- | --- | --- |
| `/api/admin/push` | seleciona `push_subscriptions` por cpf (ou todas) e chama `sendPushToSubs()` inline | síncrono, sem histórico, sem dedupe |
| `/api/push/test` | idem, escopo `session_token` | idem |
| (não existe) | WhatsApp | — |

O que falta e o hub resolve: **registro de entrega**, **deduplicação**, **preferências
por canal**, **janela/cap**, **retry com backoff**, **fallback entre canais** e uma
resposta única para "por que esse cliente não recebeu?".

## 2. Modelo mental

```
PRODUTORES (conhecem o domínio)          HUB (não conhece domínio)         CANAIS (adapters)
─────────────────────────────            ────────────────────────          ──────────────────
scheduler de faturas  ─┐
portal (botão)        ─┤
admin (broadcast)     ─┼─► notify(event) ─► resolve audiência
auth / install-request─┘                    ─► dedupe (evento único)
                                            ─► roteia por preferência/janela
                                            ─► enfileira 1 entrega/canal/destino
                                                     │
                                            dispatcher ─┴─► push adapter    ─► Web Push (VAPID)
                                                            whatsapp adapter ─► UazAPI /send/text
                                                     ▲
                                  webhook de status ─┴─ (só WhatsApp tem callback)
```

Regra de ouro: **o hub nunca importa MikWeb nem UazAPI.** Ele recebe um evento, um
`payload` genérico e uma audiência. Os adapters são a única fronteira com o provedor.
É isso que evita a duplicação: a regra "3 dias antes do vencimento" existe uma vez só,
no produtor, e o hub entrega no canal que o cliente aceitar.

## 3. Contratos

```ts
// ---------- entrada do hub ----------
export type ChannelKey = "push" | "whatsapp";
export type Priority = "transactional" | "marketing";
export type RouteMode = "primary" | "broadcast";

export interface NotifyEvent {
  key: string;                    // "billing.due_soon" — ver catálogo (§4)
  payload: Record<string, unknown>; // dados semânticos p/ templates: nome, valor, link...
  audience: Audience;
  dedupeKey?: string;             // "billing:1234:late_5" — idempotência do evento
  priority?: Priority;            // default "marketing"
  channels?: ChannelKey[];        // override do roteamento default
  mode?: RouteMode;               // default vem da regra do evento
  scheduledFor?: number;          // opcional: agendar em vez de enfileirar agora
}

export type Audience =
  | { kind: "customer"; customerId: string; cpf?: string }
  | { kind: "cpf"; cpf: string }
  | { kind: "session"; sessionToken: string }
  | { kind: "all" };              // broadcast (admin)

// ---------- resolução ----------
export interface Recipient {
  customerId?: string;
  cpf?: string;
  name: string;
  /** push: 1 destino por dispositivo; whatsapp: 1 por telefone */
  targets: Partial<Record<ChannelKey, string[]>>;
}

// ---------- render ----------
export interface Rendered {
  title?: string;   // push
  body: string;     // ambos
  url?: string;     // deep link (o SW já lê data.url → public/sw.js:141)
  tag?: string;
  icon?: string;
}

// ---------- canal ----------
export interface DeliveryContext {
  eventId: string;
  event: NotifyEvent;
  inline: boolean;              // true = devolver resultado agora (teste/admin)
}

export interface DeliveryResult {
  ok: boolean;
  providerId?: string;
  errorKey?: string;
  errorMessage?: string;
  /** destino morto (410 no push, número inválido) → desativar */
  permanent?: boolean;
  /** provedor pediu pausa global (463/time-lock) ou é 429 */
  retryAt?: number;
}

export interface ChannelAdapter {
  key: ChannelKey;
  /** o canal está operante agora? (VAPID configurado / instância connected) */
  ready(): Promise<{ ok: boolean; reason?: string; retryAt?: number }>;
  /** respeitar janela horária? null = sem janela (push é push) */
  window: { start: number; end: number } | null;
  /** limite de mensagens por cliente por dia nesse canal */
  dailyCapPerCustomer: number;
  deliver(target: string, rendered: Rendered, ctx: DeliveryContext): Promise<DeliveryResult>;
  /** provedor sinalizou destino inválido — desativar/tombstone */
  onPermanentFailure(target: string, result: DeliveryResult): Promise<void>;
}
```

## 4. Catálogo de eventos

| `key` | payload (placeholders) | roteamento default | modo | prioridade |
| --- | --- | --- | --- | --- |
| `billing.created` | nome, referencia, valor | push | broadcast | marketing |
| `billing.due_soon` | nome, valor, vencimento, link, pix | whatsapp → push | primary | marketing |
| `billing.due_today` | idem | whatsapp → push | primary | marketing |
| `billing.late` | idem + dias_atraso | whatsapp → push | primary | marketing |
| `billing.paid` | nome, referencia | push | broadcast | transactional |
| `install.received` | nome, protocolo | push (admins) | broadcast | transactional |
| `install.approved` | nome, protocolo | whatsapp + push | broadcast | transactional |
| `account.login_alert` | nome, ip, horário | push | broadcast | transactional |
| `test` | — | (explícito no request) | — | transactional |
| `admin.broadcast` | title, body | push (+whatsapp se marcado) | broadcast | transactional |

O produtor do lembrete (`sync` de faturas) emite **um** `NotifyEvent` por
(fatura, regra) e deixa o hub decidir o canal. Se o cliente não tem opt-in de
WhatsApp, o evento não é descartado — cai no push.

## 5. Roteamento

```
para cada canal em (event.channels ?? route(event.key).channels):
  1. adapter.ready() ok?              não → canal inelegível (registra o motivo)
  2. preferência do cliente ligada?   não → inelegível
  3. dentro da janela?                não → reagenda p/ próxima janela
  4. cap diário do cliente atingido?  sim → adia p/ amanhã
  5. dedupe (event.dedupeKey)         existe → ignorado
  6. enfileira entrega (status queued, scheduled_for)

modo primary  → enfileira em ordem; o dispatcher tenta o 1º e só usa o 2º se o
                1º falhar de forma definitiva (ou estiver inelegível já na resolução)
modo broadcast → enfileira todos os canais elegíveis
```

`primary` é o que evita o cliente receber push **e** WhatsApp do mesmo lembrete —
o erro clássico de fan-out ingênuo. `broadcast` fica para o que realmente merece
redundância (aprovação de instalação).

## 6. Schema (revisa §4 do `LEMBRETES-WHATSAPP.md`)

A outbox deixa de ser específica de WhatsApp:

```sql
-- intenção: 1 linha por evento de domínio
notification_events (
  id UUID PK, event_key TEXT, customer_id TEXT, cpf TEXT,
  dedupe_key TEXT UNIQUE,        -- idempotência do evento
  payload JSONB, priority TEXT,
  created_at BIGINT
)

-- entrega: 1 linha por (evento, canal, destino)
notification_deliveries (
  id UUID PK,
  event_id UUID REFERENCES notification_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,         -- 'push' | 'whatsapp'
  customer_id TEXT, cpf TEXT,
  target TEXT NOT NULL,          -- endpoint (push) | phone_e164 (whatsapp)
  rendered JSONB,                -- {title, body, url} | {text}
  status TEXT NOT NULL,          -- queued|sending|sent|delivered|read|failed|skipped|canceled
  attempts INT DEFAULT 0,
  scheduled_for BIGINT NOT NULL,
  provider_id TEXT, error_key TEXT, error_message TEXT,
  sent_at BIGINT, status_at BIGINT, created_at BIGINT,
  UNIQUE (event_id, channel, target)
)

notification_templates (
  id, channel TEXT, key TEXT, name TEXT,
  title TEXT, body TEXT,         -- push usa title; whatsapp ignora
  active BOOLEAN, updated_at BIGINT,
  UNIQUE (channel, key)
)

-- preferências: 1 linha por cliente × canal
notification_preferences (
  id, customer_id TEXT, cpf TEXT, channel TEXT,
  enabled BOOLEAN DEFAULT false,
  opt_in_at BIGINT, opt_out_at BIGINT, source TEXT,  -- portal|atendimento|contrato
  updated_at BIGINT,
  UNIQUE (customer_id, channel)
)
```

Mantém-se de `LEMBRETES-WHATSAPP.md`: `whatsapp_config`, `whatsapp_contacts`
(telefone + status do número) e `whatsapp_events` (dedupe de webhook).
`whatsapp_reminder_rules` vira `notification_rules` com coluna `event_key`, já que
as regras produzem eventos, não mensagens.

**Como ficou na implementação** (`notification_config`, migration 004): a régua inteira
é um **documento JSONB** numa linha (`notification_config.settings`), não uma tabela de
linhas. Salvar a régua é uma escrita atômica — não existe estado meio-aplicado — e o
documento é exatamente o objeto que o simulador reporta. O que continua dono do canal é
`whatsapp_config` (cota, janela, ligado/desligado): um dono por chave, para o painel não
sobrescrever a config do canal ao salvar a régua.

Cada rodada carrega um **fingerprint** (`s1-xxxxxxxx`) da configuração efetiva: ele entra
no relatório do simulador e é o que permite comparar "o que foi simulado" com "o que o
dispatcher vai ler" sem depender de memória. Overrides de simulação são declarados em
`overrides` — não se misturam com o que está salvo. Ver `LEMBRETES-WHATSAPP.md` §15b.

Integridade interessante: `UNIQUE (event_id, channel, target)` no banco é o que
impede entrega duplicada mesmo se dois dispatchers rodarem ao mesmo tempo — o
`dedupe_key` protege o evento, esse índice protege a entrega.

## 7. Preferências e opt-in

- `push`: hoje o opt-in é implícito (existir linha em `push_subscriptions`). O hub
  passa a exigir `notification_preferences(customer_id,'push').enabled` — o
  `usePushNotifications` grava a preferência ao assinar. Assim "recebi mas não quero"
  é respeitado sem apagar o dispositivo.
- `whatsapp`: opt-in explícito no portal (§9 do doc de lembretes).
- Opt-out por canal é granular: sair do WhatsApp não desliga o push.

## 8. Dedupe, janela e caps

- **Dedupe de evento**: `dedupe_key` único. Ex.: `billing:1234:late_5`.
- **Dedupe de entrega**: `UNIQUE(event_id, channel, target)`.
- **Janela**: push `null` (e o SW decide exibir silencioso das 22h–7h), WhatsApp
  9h–20h configurável.
- **Cap**: push sem cap rígido (é barato e consentido); WhatsApp
  `cap diário por cliente` + `cap de novas conversas` (cota global, configurada no painel
  em `whatsapp_config.daily_new_chat_cap`). `/instance/wa_messages_limits` informa o
  limite do provedor, mas **não** é a fonte da decisão: o número não pode depender de uma
  consulta externa para saber quando parar.
- **Prioridade `transactional` ignora janela** — "fatura paga" e "teste" passam na hora.
- **Imposto hoje**: janela (antes de reservar; o lote fica na fila), cota por cliente/dia
  e **cota de novas conversas** — esta última reservada no banco antes do envio, com
  histórico de conversa lido da própria outbox (`reserve_new_chat_slot`, ver
  `LEMBRETES-WHATSAPP.md` §15c). Quem decide se a entrega abre conversa nova é a
  existência de envio anterior bem-sucedido para o mesmo destino — a mesma regra que o
  simulador usa. O time-lock 463 continua sendo tratado como pausa global, mas deixa de
  ser o único freio: o número para antes de a restrição acontecer.

## 9. Dispatcher

Um só loop para todos os canais, com claim atômico:

```
claim_deliveries(limit)  →  SELECT ... FROM notification_deliveries
                            WHERE status='queued' AND scheduled_for <= now()
                            ORDER BY scheduled_for
                            FOR UPDATE SKIP LOCKED
                            LIMIT n
para cada entrega:
  adapter = adapters[channel]
  r = await adapter.deliver(target, rendered, ctx)   // timeout curto
  r.ok            → status 'sent' | 'delivered' (+ status_at)
  r.permanent     → 'failed' + adapter.onPermanentFailure()  (ex: remove endpoint 410)
  r.retryAt       → 'queued' com scheduled_for = retryAt (backoff + jitter)
  erro transitório→ attempts++ ; backoff 1s/2s/4s/8s com jitter; máx N tentativas
```

Duas chamadas públicas no hub, porque push e WhatsApp têm naturezas diferentes:

```ts
notify(event): Promise<void>                 // enfileira (automação) — default
notifyAndWait(event): Promise<DeliveryResult[]> // entrega inline (teste, admin, "enviar agora")
```

`notifyAndWait` existe só para os casos em que a UI precisa do resultado na hora
(`/push/test` continua respondendo "entregou/não entregou"). Ele usa os mesmos
adapters e grava as mesmas linhas — não é um caminho paralelo.

⚠️ **`rendered` é montado no momento do ENVIO, não do enfileiramento.** Um aviso de
atraso agendado para depois precisa contar os dias no dia em que sai — guardar o texto
no `enqueue` congela "0 dias em atraso" numa mensagem que sai três dias depois. O
simulador (`LEMBRETES-WHATSAPP.md` §14) pegou exatamente esse erro, por isso renderiza
com a data de `scheduledFor` e não com a data da simulação.

## 10. Status e observabilidade

| Canal | Como sabemos o resultado |
| --- | --- |
| push | resposta do serviço de push (2xx/404/410). **Não há webhook.** `delivered` nunca é confirmado — o status máximo é `sent` |
| whatsapp | `POST /send/text` confirma enfileiramento; `delivered`/`read`/`failed` chegam por webhook (`messages_update`) |

Diferença que precisa aparecer na UI para não mentir no painel: no push, `sent` é
o teto; no WhatsApp, `delivered` e `read` são reais.

Toda mutação de status vai para `notification_deliveries` **e** para
`mikweb_audit_log` (`notify_sent`, `notify_failed`, `notify_opt_out`), mantendo a
trilha que o painel admin já mostra.

## 11. Impacto no código atual

| Hoje | Depois |
| --- | --- |
| `sendPushToSubs()` monta e envia inline, e apaga endpoints 410 dentro dela | vira `adapters/push.ts`; a limpeza de 410 migra para `onPermanentFailure` |
| `/api/admin/push` seleciona subs e chama `sendPushToSubs` | `notifyAndWait({key:'admin.broadcast', audience:'all', payload:{title, body}})` |
| `/api/push/test` idem, por sessão | `notifyAndWait({key:'test', audience:{kind:'session'}, channels:['push']})` |
| `/api/push/subscribe` só grava a inscrição | idem + `notification_preferences(customer, 'push', enabled=true)` |
| `/api/push/unsubscribe` apaga o endpoint | idem + preferência `enabled=false` |
| lembrete de fatura (novo) | produtor `billing/reminders.ts` → `notify({key:'billing.due_soon'})` |

O adapter de WhatsApp é o `uazapi.ts` do doc anterior com uma casca fina que
implementa `ChannelAdapter` (incluindo `error_key: WHATSAPP_REACHOUT_TIMELOCK → retryAt`
na instância inteira).

## 12. Frontend

- `src/lib/notifications.ts` — `useNotificationPreferences()` (lê/grava por canal) e
  um `notifyClient()` para chamadas `notifyAndWait` do admin.
- `src/components/NotificationPreferences.tsx` — um componente só, usado no
  `Profile` (cliente escolhe push/WhatsApp) e no admin (preview + broadcast),
  com toasts `sonner` e estados de loading com `Loader2` (padrão do projeto).
- `public/sw.js` já lê `data.url` — o hub só precisa preencher `rendered.url` com
  `/faturas/<id>` para o clique abrir a fatura.

## 13. Arquivos

```
supabase/functions/api/
  notify/
    hub.ts          → notify(), notifyAndWait(), resolveAudience(), routing
    outbox.ts       → enqueue(), claim (RPC SKIP LOCKED), updateStatus()
    templates.ts    → render(channel, key, payload) — placeholders comuns
    registry.ts     → mapa de adapters
    channels/
      push.ts       → ChannelAdapter sobre o sendPushToSubscription existente
      whatsapp.ts   → ChannelAdapter sobre uazapi.ts
    billing.ts      → produtor: faturas → eventos (regras D-3/D0/D+1/D+5)
supabase/migrations/003_notifications.sql
```

## 14. Fases

| Fase | Entrega |
| --- | --- |
| 0 | tabelas + hub + adapter push + migrar `/admin/push` e `/push/test` (zero regressão, já dá histórico e dedupe) |
| 1 | adapter WhatsApp + produtor billing + envio sob demanda (`notifyAndWait`) |
| 2 | dispatcher agendado + regras + caps/janela + fallback `primary` |
| 3 | webhook de status/opt-out + painel unificado (enviados por canal, entrega, opt-outs) |
| 4 | preferências no portal, silencioso em horário noturno no push, `install.approved` e alerta de login no hub |
