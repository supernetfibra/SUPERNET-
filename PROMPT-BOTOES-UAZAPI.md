# PROMPT PARA A IA — Botões de ação rápida nas mensagens de WhatsApp via UazAPI

> Copie tudo abaixo deste bloco e cole na IA do outro projeto. O prompt é autocontido:
> não assume conhecimento do projeto original, só da API da UazAPI.

---

## Objetivo

Implementar o envio de mensagens de WhatsApp (via UazAPI) com **botões de ação rápida**
anexados: "Copiar código Pix", "Copiar código de barras" e/ou "Abrir portal/PDF".
Quando o cliente **toca** num botão, registrar o clique via webhook para métricas.

Requisitos não negociáveis (a UazAPI é instável nesse recurso — o design todo existe
por causa disso):

1. **Máximo 3 botões** por mensagem (limite do WhatsApp).
2. **Fallback obrigatório para texto puro** se a UazAPI recusar o menu interativo —
   a própria doc da UazAPI avisa que "recursos interativos podem ser descontinuados
   a qualquer momento". O cliente NUNCA pode ficar sem o código de pagamento.
3. **Idempotência dos cliques** no webhook (a UazAPI reentrega eventos).
4. Nenhum código copiável no corpo do texto quando os botões funcionam — e o
   fallback religa os códigos quando os botões falham.

---

## 1. Como a UazAPI expõe botões

Existem dois endpoints de envio:

- `POST /send/text` — texto puro. Body: `{ number, text, linkPreview, delay?, async?, track_id?, readchat? }`.
- `POST /send/menu` — mensagem interativa. Para botões de ação, body:

```json
{
  "number": "5511987654321",
  "type": "button",
  "text": "corpo da mensagem",
  "choices": [
    "Copiar código Pix|copy:00020126580014BR.GOV.BPI...",
    "Copiar código de barras|copy:34191090123456789012345678901234512345678901234",
    "Abrir portal|https://portal.exemplo.com/faturas/123"
  ]
}
```

Regras exatas do formato de `choices`:

- Cada choice é a string `"Rótulo|copy:CÓDIGO"` (botão nativo de copiar do WhatsApp)
  ou `"Rótulo|URL"` (abre o link). Sem `|`, vira botão de resposta simples — **não usar**:
  misturar botões de resposta com copy/url na mesma mensagem **quebra a exibição** (doc da UazAPI).
- Máximo 3 choices.
- `number` é E.164 **sem `+` e sem símbolos, só dígitos** (ex.: `5511987654321` — 12–13 dígitos para BR).

Headers de autenticação: `token: <token da instância>` para enviar mensagens
(o `admintoken` é só para criar/listar instâncias — nunca usar aqui, nunca logar token).

Resposta de sucesso (parse defensivo, a UazAPI varia o formato):

```json
{ "messageid": "...", "status": "sent", "response": { "status": "..." } }
```

- `providerId` = `messageid` ?? `id` da raiz.
- `status` = `status` da raiz ?? `response.status`.

## 2. Fallback: quando a UazAPI recusar o menu (HTTP 400, 422 ou 500)

O envio do `/send/menu` é tentado primeiro. Se falhar com **400/422/500**, cair para
`/send/text` em **duas partes**:

1. **O texto vai limpo** (sem os códigos — eles nunca estiveram no corpo), com uma
   nota no final:

   ```
   ⚠️ Os botões não estavam disponíveis — o código vem na mensagem seguinte: copie a mensagem inteira.
   ```

2. **Cada código copiável vira uma mensagem PRÓPRIA** (`/send/text`) contendo **SÓ o
   código** — sem prefixo `📋 Rótulo:`, sem quebras de linha. Motivo: o "copiar
   mensagem" do WhatsApp copia a mensagem inteira; qualquer prefixo/quebra contamina
   o valor colado no app do banco.

3. Botões de **URL** não viram mensagem separada: entram como linha `🔗 Rótulo: URL`
   no corpo do fallback, **apenas se a URL ainda não aparecer no texto** (links de
   boleto normalmente já estão no corpo via variáveis de template).

4. **Best-effort nos follow-ups**: a mensagem principal JÁ SAIU. Se um código falhar
   depois, NÃO marcar a entrega original como falha (isso reenviaria a mensagem
   inteira e duplicaria a mensagem para o cliente). Registrar os erros dos follow-ups
   em um campo de diagnóstico (ex.: `raw.followupErrors`) e seguir.

## 3. Derivação dos botões (a partir do payload semântico do evento)

Os botões são **derivados do payload**, não escritos à mão por template — a mesma
fatura produz os mesmos botões em qualquer template. Prioridade:

1. **Pix copiável** (`payload.pix`) → `{ label: "Copiar código Pix", copy: <pix> }`
2. **Boleto**: se existir linha digitável com **≥ 44 dígitos numéricos** (limpar tudo
   que não é dígito antes de contar) → `{ label: "Copiar código de barras", copy: <linha> }`;
   senão, se existir URL do boleto → `{ label: "Baixar PDF da fatura", url: <url> }`
3. **Link do portal** (`payload.link`) → `{ label: "Abrir portal", url: <link> }` —
   só se ainda houver vaga (< 3).

`slice(0, 3)` no final. Pix primeiro: é o caminho de pagamento mais rápido.

O corpo dos templates de WhatsApp deve **apontar** para o botão e não conter o código:

```
Pague com o Pix copiável no botão abaixo. 👇
```

## 4. Persistência

- As ações moram no **payload do evento** (JSONB) sob uma chave de metadado — ex.:
  `__actions` (prefixo `__` = não é placeholder de template; o renderizador descarta).
  Assim, um **reenvio** do mesmo aviso reusa as ações sem re-renderizar.
- Espelhar as ações na **linha da entrega** (coluna `actions JSONB` em
  `notification_deliveries` ou equivalente) para consulta rápida na fila e para o
  casamento de cliques (item 6). Índice parcial: `WHERE actions IS NOT NULL`.
- Tabela de cliques (apêndice, sem update/delete):

```sql
CREATE TABLE whatsapp_button_clicks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   BIGINT NOT NULL,            -- epoch ms
  phone_e164   TEXT,
  button_label TEXT,
  selected_row TEXT,                       -- texto da linha selecionada, se diferente do rótulo
  message_id   TEXT,                       -- id da MENSAGEM DE RESPOSTA (identifica o clique)
  provider_id  TEXT,                       -- contextInfo.stanzaId (id da mensagem original)
  delivery_id  UUID REFERENCES notification_deliveries(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX uq_wa_button_clicks_message
  ON whatsapp_button_clicks (message_id) WHERE message_id IS NOT NULL;
```

- View de métricas (30 dias) por rótulo: `clicks`, `unique_phones`, `matched`
  (com `delivery_id`), `unmatched`, `last_click_at`. **Cuidado com overflow de
  inteiro** ao converter segundos→ms no SQL (`30 * 86400 * 1000` estoura int4 se
  multiplicado como literal inteiro — usar `(extract(epoch from now()) - 30 * 86400) * 1000`).

## 5. Cliente UazAPI (camada HTTP)

Encapsular num cliente com `sendText({ number, text, actions?, delay?, trackId?, ... })`:

- Se `actions` não vazio → tentar `POST /send/menu` (type `button`) montando os
  `choices` como no item 1; em 400/422/500 aplicar o fallback do item 2.
- Sempre passar `track_id` (correlação com o evento — atenção: **não é garantia de
  idempotência** no lado da UazAPI) e `delay` (ms, mostra "digitando...").
- Delay pseudo-humano com jitter entre envios (ex.: 2,5–9 s, semeado pelo id do
  evento): rajada de mensagens no mesmo instante é padrão que o WhatsApp penaliza.
- Normalizar o telefone no enfileiramento (só dígitos, E.164 sem `+`). Alvo malformado
  = falha **permanente**, sem retry.

Taxonomia de erros (mapear todo erro da UazAPI para um destes desfechos):

| Erro | Desfecho |
|---|---|
| `error_key: WHATSAPP_REACHOUT_TIMELOCK` ou `provider_code: 463` | `retryAt` = `details.reachout_timelock.until` (ou header `Retry-After`); **pausar o canal globalmente** — insistir num bloqueio de novas conversas restringe o número de vez |
| HTTP 401/403 | falha **permanente** (token inválido não melhora com retry) |
| HTTP 400/422 | falha permanente (payload ruim não melhora repetido) — mas antes aplicar o fallback de botões |
| HTTP 429/5xx | transitório; respeitar `Retry-After` |
| timeout/rede (nosso fetch abortou) | **incerto** — o envio PODE ter saído; NUNCA repetir cego (duplica mensagem). A doc da UazAPI é explícita sobre evitar duplicações |

Mensagem de erro: preferir `message_ptbr` ?? `error` ?? `provider_message_ptbr` do corpo.

## 6. Webhook — registro de cliques

Inscrever o webhook da instância nos eventos **`messages`** (traz acks E respostas
de clientes — é por ele que o clique chega), `messages_update` (status) e
`connection`; **excluir `wasSentByApi`** para o canal não enxergar o próprio eco.

Quando o cliente toca um botão, a UazAPI entrega um evento de mensagem com:

- `messageType` = `buttonsResponseMessage`
- texto do botão em `message.buttons_response_message.selectedDisplayText`
- id da mensagem **original** em `message.contextInfo.stanzaId`

Processamento (em ordem):

1. **Casa a entrega**: por `provider_id == stanzaId`; se não achar, fallback por
   telefone + última entrega `status = sent` cujo `actions` **contém** o rótulo do
   botão (`contains actions, [{"label": <selectedDisplayText>}]`).
2. **Insere o clique** com `button_label` (truncado a 120 chars), `message_id` do
   evento e `delivery_id` do casamento. Erro de chave duplicada (23505) = reentrega
   → contar como ignorado, não como clique novo.
3. Um clique **não é texto livre**: não passa pelo detector de opt-out ("SAIR",
   "cancelar" etc.) nem cai no balde de "ignorado".

Idempotência do webhook em geral: status de entrega atualiza-se por `provider_id`
(o `messageid` devolvido no envio).

## 7. Painel (opcional, mas recomendado)

Endpoint de admin que lê a view de estatísticas e mostra no painel: cliques por
rótulo nos últimos 30 dias, telefones únicos, % casada com uma entrega. Isso responde
"a pergunta de negócio": quantos clientes realmente usam o Pix copiável do botão
versus abrir o portal.

## 8. Critérios de aceite (testar todos)

1. Fatura com Pix → mensagem sai por `/send/menu` com choice `Copiar código Pix|copy:<pix>` e o corpo do texto **não contém** o código Pix nem a linha digitável.
2. Fatura com Pix + linha digitável (44+ dígitos) + link → exatamente 3 botões, Pix primeiro.
3. UazAPI responde 400 no `/send/menu` → mensagem de texto sai com a nota de aviso, cada código vira uma mensagem própria contendo SÓ o código, URLs entram como `🔗` apenas se ausentes do corpo.
4. Follow-up de código falha depois da mensagem principal ter saído → entrega NÃO é marcada como falha; erro registrado em diagnóstico.
5. Webhook com `buttonsResponseMessage` → clique gravado, casado com a entrega por `stanzaId`.
6. Mesmo evento de clique entregue 2× → segundo é ignorado (unique em `message_id`).
7. Mensagem de texto comum do cliente ("SAIR") → opt-out; clique de botão nunca dispara opt-out.
8. Time-lock (463) → canal pausado até `until`; nenhuma tentativa no intervalo.
9. Timeout do fetch → entrega marcada como incerta, dispatcher não reenvia.
10. Reenvio manual de um aviso → reusa as ações gravadas no evento (sem re-render).

## 9. Armadilhas já aprendidas (não repetir)

- Tratar `status` da raiz de `/instance/status` como string: às vezes é **objeto**
  (`{"status":{"connected":true,...}}`) — normalizar antes, senão uma instância
  conectada aparece como "desconhecida" e o canal para.
- Prefixos tipo `📋 Rótulo:` nas mensagens de código contaminam o valor colado.
- Multiplicar literais inteiros grandes no SQL (epoch ms) → `integer out of range`.
- Confiar no `track_id` como idempotência — não é; use a tabela de entregas.
- Misturar botões de resposta com copy/url na mesma mensagem — quebra a exibição.
- Colocar os códigos no corpo do template "por garantia" — com botões é redundante
  (~80 chars ilegíveis) e o fallback já religa os códigos quando necessário.
