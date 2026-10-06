# AUDITORIA UI/UX — Portal do Assinante Supernet Fibra

> Diagnóstico completo produzido em 04/10/2026, antes de qualquer alteração.
> Escopo varrido: 21 páginas, 14 componentes compartilhados, 55 primitivos shadcn
> instalados, tema em `src/index.css`, layouts cliente/admin e comparação entre telas.
> Nenhum arquivo foi alterado durante esta auditoria.

---

## 1. RESUMO EXECUTIVO

**O que o produto é hoje:** portal white-label (cliente + admin) para provedora de
internet, em React 19 + Tailwind v4 + shadcn/ui, com área do cliente (faturas,
perfil, indicações) e painel administrativo (instalações, indicações, conexões,
régua WhatsApp, mensagens/outbox, simulador).

**Maturidade da interface: 6,5/10 — madura no cliente, inconsistente no admin.**
A área do cliente tem identidade visual clara ("Minimalism": quase monocromática,
sem sombras, radius 4px), navegação consistente (sidebar desktop + bottom nav
mobile espelhados nos dois layouts) e um fluxo de faturas bem resolvido. O painel
admin, construído por acréscimo ao longo do tempo, acumulou: um dashboard
"mega-página" de 1.822 linhas que duplica funções de páginas dedicadas, 5
tipografias diferentes para o mesmo card de KPI, 4 sistemas paralelos de badge de
status, 11 cópias do helper `adminFetch`, e dados de operação (funil de
engajamento) no lugar menos lógico possível (dentro da tela de credenciais).

**Principais problemas encontrados (top 5):**

1. **P0** — Bottom nav do admin com 8 itens não cabe em mobile (8 × 64px = 512px >
   375px de viewport) e os 8 destinos também não cabem semanticamente numa barra
   de ícones.
2. **P0** — A mesma fatura recebe **rótulos e cores diferentes conforme a tela**
   (ex.: "Em aberto"/âmbar no dashboard admin vs. "A vencer"/azul na área do
   cliente) — 4 mapeamentos de status paralelos convivendo.
3. **P0** — Aprovar/Recusar solicitação de instalação **sem confirmação e sem
   preview** no dashboard, enquanto toda ação de envio de mensagem tem
   ConfirmDialog com prévia — criticidade invertida.
4. **P1** — `adminFetch`/`getAdminToken`/`withAdminToken` copiados manualmente em
   **11 arquivos**; qualquer mudança de autenticação precisa ser replicada 11 vezes.
5. **P1** — 356 tamanhos de fonte arbitrários (`text-[10px]` ×256, `[11px]` ×84,
   `[9px]` ×16) e 200+ cores cruas de status espalhadas — o Design System existe
   como kit shadcn instalado, mas só ~9 primitivos de 55 são realmente usados.

**Base boa para herdar:** `InvoiceCard` (componente com variantes),
`status-config.ts` (fonte única de status), `ConfirmDialog`, `skeletons.tsx`, os
layouts espelhados `AppLayout`/`AdminLayout` e o formulário de instalação da
`Landing`. Estes são os candidatos naturais a núcleo do Design System.

---

## 2. ESTADO ATUAL POR CATEGORIA VISUAL

| Elemento | Estado atual | Evidência |
|---|---|---|
| **Cores** | Tokens oklch monocromáticos bem definidos, mas 200+ usos de paleta crua de status: `emerald-5`×75, `amber-5`×57, `red-5`×42, `blue-5`, `sky-5`, `teal-5`, `violet-5`, `orange-5`, `yellow-5` | `src/index.css`, grep em pages/components |
| **Tipografia** | 4 tamanhos arbitrários (9/10/11px) somam 356 ocorrências; escala de títulos varia entre `text-xl font-medium`, `text-lg font-semibold` e `text-base font-semibold` | AdminDashboard vs AdminReferrals vs Referrals |
| **Espaçamentos** | Contêineres variam: `max-w-4xl` (padrão cliente), `3xl` (detalhe fatura), `5xl` (Referrals), `6xl` (AdminDashboard/InstallRequests/Referrals), `7xl` (AdminMessages) | grep `max-w-*`: 8×4xl, 5×7xl, 3×6xl… |
| **Bordas/radius** | `--radius: 0.25rem` global; mistura de `rounded-sm`(153), `rounded-md`(67), `rounded-lg`(35), `rounded-full`(75) sem regra clara de quando usar cada um | grep |
| **Sombras** | Regra "shadow-none" dominante (coerente com o tema), mas `shadow-sm`/`shadow-md` reaparecem só no card destacado de fatura — ok, porém não documentado | `InvoiceCard.tsx` |
| **Ícones** | Lucide consistente; botões-ícone de refresh sem `aria-label` em 4 telas; ícones decorativos e funcionais sem diferenciação | AdminDashboard tem **0** atributos `aria-` |
| **Botões** | Base shadcn + ripple CSS; mesmas ações com estilos divergentes ("Disparar fila": outline-esmeralda no Dashboard vs `bg-emerald-600` sólido em Mensagens; WhatsApp `#25D366` hardcoded ×2) | AdminDashboard.tsx:927 vs AdminMessages.tsx:526 |
| **Inputs/Selects** | Select shadcn em 9 arquivos (consistente); input de busca com ícone montado à mão só em Faturas; sem `InputGroup` apesar de instalado | `Invoices.tsx` |
| **Checkboxes** | 3 implementações: shadcn `Checkbox` (Landing — correto), `<input type="checkbox">` nativo (Login, AdminDashboard, ReminderMessagesCard) | grep `type="checkbox"` |
| **Modais/Dialogs** | 62 usos de `<Dialog>`; confirmações divididas entre `ConfirmDialog` (AlertDialog, spinner integrado — bom) e Dialogs ad-hoc (resgate em Referrals); nenhum uso de Sheet/Drawer | grep |
| **Tooltips** | Primitivo instalado, **zero usos** — ações só-ícone (Lembrar, refresh) ficam sem explicação | grep |
| **Badges** | 12 arquivos usam `Badge`, mas cores de status montadas à mão em cada tela; 4 sistemas paralelos (ver P0-2) | `status-config.ts` vs AdminDashboard.tsx:113 |
| **Cards** | `Card` shadcn consistente, mas KPI cards têm **5 tipografias de número**: `text-lg font-light` (AdminDashboard), `text-lg font-semibold` (InstallRequests), `text-2xl font-semibold` (Mensagens), `text-xl font-bold` (AdminReferrals), `text-2xl font-light` (cliente) | comparação direta |
| **Tabelas** | `ui/table` usado **só no Simulador**; Mensagens, Audit log, Outbox e listas admin usam divs hand-rolled sem header sticky, sem ordenação, sem paginação | AdminSimulator.tsx:1021 |
| **Sidebar/Header** | Os dois layouts são espelhados e consistentes (ponto forte); header de página, porém, tem 4 padrões: simples (cliente), +ações à direita (Mensagens), +badge+refresh (InstallRequests), +botão voltar (AdminReferrals/Referrals) | layouts |
| **Breadcrumbs** | Não existem; navegação de volta é botão "Voltar para faturas" (fatura) e seta (indicações) — ok para profundidade 2 | `InvoiceDetail.tsx` |
| **Abas** | `Tabs` só no AdminDashboard (escopo do log) e em Mensagens; filtros em Faturas são chips hand-rolled — 2 padrões para o mesmo trabalho | `AdminDashboard.tsx` |
| **Paginação** | Primitivo instalado, zero usos; todas as listas admin são `max-h-xxx overflow-y-auto` | grep |
| **Alertas** | `ui/alert` instalado, zero usos; banners de aviso montados à mão com cores cruas (amber/emerald/red) em Dashboard (3×), Invoices (2×), Mensagens, Conexões | `Dashboard.tsx` |
| **Toasts** | Sonner em 19 arquivos (padrão de fato) + wrapper `useToast` em 2 arquivos — API dupla para o mesmo sistema | grep `use-toast` |
| **Skeletons** | `skeletons.tsx` centralizado para lazy-load (bom), mas `Profile.tsx` tem **outro** skeleton inline quase idêntico ao `ProfileSkeleton`; páginas admin usam spinner ou skeleton local, cada um do seu jeito | Profile.tsx:170–240 |
| **Empty states** | Cada tela desenha o seu (Invoices, AuditLog, Sessões, InstallRequests, Conexões, Referrals…) com ícone+texto centrado; `ui/empty` instalado, zero usos | grep |
| **Loading** | 3 padrões: spinner centrado `Loader2`, skeleton estrutural, e botão com spinner — sem regra de quando usar cada um | várias |
| **Erro** | 5 padrões: banner âmbar (offline), estado centrado com botão (Perfil), card py-12 (AdminReferrals), tela cheia "Sessão não encontrada" (AdminDashboard), ErrorBoundary — nenhum com retry padronizado | várias |
| **Disabled** | Consistente via shadcn (opacity) + `disabled={loading}`; boa cobertura | várias |
| **Responsivo** | Bottom nav + sidebar espelhados (bom); pull-to-refresh no cliente (bom); tabelas admin e bottom nav de 8 itens quebram em mobile | AdminLayout.tsx:246 |

---

## 3. ACHADOS POR PRIORIDADE

### P0 — Críticos

**P0-1 · Bottom nav do admin transborda em mobile**

- **Tela:** `AdminLayout.tsx` (linha ~246)
- **Problema:** 8 itens com `min-w-[64px]` = 512px mínimos num viewport de 375px.
- **Evidência:** `adminNavigation` tem 8 rotas renderizadas na `<nav>` fixa inferior.
- **Impacto:** operador no celular (contexto real do painel — WhatsApp/faturas) vê
  ícones comprimidos ou barra cortada.
- **Recomendação:** barra com 4 destinos (Início, Pedidos, Mensagens, Mais…) +
  sheet "Mais" com o restante; ou hamburger para admin no mobile.
- **Esforço:** baixo · **Local**

**P0-2 · Mesma cobrança, cores/labels diferentes por tela**

- **Telas:** `status-config.ts` vs `AdminDashboard.tsx` (`statusBadgeClass`) vs
  AdminMessages vs Referrals/AdminReferrals (badges manuais)
- **Problema:** o cliente vê "A vencer" em **azul**; o admin, a mesma fatura
  "Em Aberto" em **âmbar**. Referrals usa `emerald-500/15`, InvoiceCard usa
  `emerald-50`… 4 mapeamentos paralelos.
- **Impacto:** erro de interpretação de cobrança (cor carrega a decisão de
  "cobrar ou não").
- **Recomendação:** um único `StatusBadge` alimentado por `status-config.ts`
  estendido (fatura, entrega, indicação, resgate, conexão), consumido por todas
  as telas.
- **Esforço:** médio · **Sistêmico**

**P0-3 · Ação crítica sem confirmação, ação simples com confirmação**

- **Telas:** `AdminDashboard.tsx` (~linha 1595, aprovar/recusar instalação, inline,
  1 clique, sem confirmação) vs. envio de lembrete (ConfirmDialog + prévia da
  mensagem)
- **Impacto:** recusar um cliente por clique acidental; hierarquia de confirmação
  invertida.
- **Recomendação:** ConfirmDialog com motivo opcional para recusa; padrão único:
  **toda ação de estado tem confirmação proporcional à irreversibilidade**.
- **Esforço:** baixo · **Local**

### P1 — Alta prioridade

| # | Achado | Evidência | Recomendação | Esforço |
|---|---|---|---|---|
| P1-1 | `adminFetch` duplicado em 11 arquivos | grep `getAdminToken` — AdminDashboard, AdminSettings, AdminMessages, InstallRequests, Simulator, Connections + 5 componentes | Mover para `api-config.ts` como `adminFetch()` único | baixo · sistêmico |
| P1-2 | AdminDashboard é mega-página: branding, audit log, consulta de cliente, envio de lembrete, sessões, instalações, métricas de indicações (1.822 linhas) | `AdminDashboard.tsx` | Fatiar: auditoria vira tela própria; consulta de cliente vira página "Cliente 360"; dashboard fica só com métricas + atalhos | alto · sistêmico |
| P1-3 | Gestão de instalações duplicada (dashboard card + página completa, com regras divergentes) | dashboard: inline sem confirmação; página: bulk + lightbox + impressão | Dashboard mostra só contadores pendentes com link; edição só na página | médio |
| P1-4 | `Referrals.tsx` renderiza **header próprio sticky dentro do AppLayout** (header duplo, `min-h-screen` dentro de `main`) | linha 215 | Remover header local; usar PageHeader do layout | baixo |
| P1-5 | KPI cards com 5 tipografias de número e 3 densidades | comparação acima | Componente `KpiCard` (label, valor, ícone, tom) — um só padrão | médio |
| P1-6 | Funil de engajamento (enviado→entregue→lido→Pix) mora em **Conexões** (tela de credenciais) | AdminConnections.tsx:1078 | Mover para Mensagens (aba "Funil") — dado de operação de mensagem | médio |
| P1-7 | Listas sem paginação/ordenação (audit log, outbox, sessões) — scroll infinito `max-h` | AdminDashboard `max-h-[500px]` | DataTable com paginação + header sticky | médio · sistêmico |
| P1-8 | Duas APIs de toast; checkboxes nativos vs shadcn; dois padrões de confirmação | Profile `useToast` vs resto; Login:310 raw checkbox | Padronizar sonner direto; `Checkbox` shadcn em todos | baixo |
| P1-9 | Botões de "mesma ação" com estilos divergentes (Disparar fila; WhatsApp verde `#25D366` ×2; sync outline-esmeralda) | AdminMessages:526 vs AdminDashboard:930 | Variantes semânticas no tema (`success`, `whatsapp`) em vez de classes ad-hoc | baixo |

### P2 — Melhorias relevantes

- **P2-1 · Tipografia arbitrária (356 usos de 9–11px).** Criar escala: `text-xs`
  (12) como piso para dados, tokens `caption/label/micro` no tema. Sistêmico, médio.
- **P2-2 · Empty states ad-hoc ×6.** Adotar `ui/empty` (já instalado) via
  componente `EmptyState` com ação. Baixo.
- **P2-3 · Estados de erro sem padrão.** `ErrorState` com retry (hoje: reload da
  página inteira em Dashboard/Invoices). Médio.
- **P2-4 · Banner "dados offline" duplicado** entre `Dashboard.tsx` (linha ~273) e
  `Invoices.tsx` (linha ~237) — extrair `StaleDataBanner`. Baixo.
- **P2-5 · Skeleton duplicado do Perfil** (`Profile.tsx` duplica
  `ProfileSkeleton`). Usar um só. Baixo.
- **P2-6 · Tabelas div-based.** Mensagens/Outbox/Audit → `DataTable` sobre
  `ui/table` (já provado no Simulador). Médio.
- **P2-7 · Dead code:** `LogoDropdown` (não importado e importa asset inexistente),
  handlers de branding no AdminDashboard (linhas 810–850, sem JSX), `AdminLogin`
  (redirect puro). Remover. Baixo.
- **P2-8 · Sheet/Drawer zero usos.** Detalhes (foto de instalação, entrega da
  outbox) em drawer no mobile e diálogo no desktop. Médio.

### P3 — Refinamentos

- Ripple global aplica `transition` em **todos** os elementos (`:root *`) — pode
  causar jank em listas longas; considerar escopar a `[data-slot]`.
- Animações de entrada ignoram `prefers-reduced-motion` (o `@media` cobre só a
  transição de tema).
- Scrollbar custom de 6px — ok, documentar.
- 404 (`NotFound.tsx`) sem botões de ação (só link sublinhado).
- Chips de filtro em Faturas com `text-[10px] uppercase` — acima do piso
  tipográfico proposto.

---

## 4. O QUE JÁ FUNCIONA BEM

1. **Layouts espelhados** cliente/admin (`AppLayout`, `AdminLayout`): mesma
   sidebar, mesmo bottom nav, mesmo sistema de badge de contagem — parece um
   produto só.
2. **`InvoiceCard` com variantes** (`highlight/default/dashboard`): unificou 3
   implementações, tem memo comparativo e ações consistentes. **Modelo oficial de
   componente de domínio.**
3. **`status-config.ts`**: centraliza status refinado ("Vence hoje", "A vencer")
   com ícone+cor+label. **Base do StatusBadge oficial.**
4. **`ConfirmDialog`**: confirmação com prévia, spinner, bloqueio durante envio.
   **Base do padrão de confirmação.**
5. **`skeletons.tsx`**: skeletons estruturais por rota como fallback de lazy-load —
   transição sem "flash".
6. **Fluxo de pagamento do cliente**: fatura destacada → detalhe com QR Pix gerado
   na hora, copiar linha/PIX com toast + auditoria — eficiente e com feedback em
   cada passo.
7. **`Landing`**: formulário de instalação exemplar — máscaras, busca de CEP,
   honeypot, aceite de termos em Dialog reutilizando `terms-content` (mesmos
   componentes das páginas /termos e /privacidade — bom reuso).
8. **Login em 2 passos** (`Login.tsx`) com validação inline, estado de
   sucesso/erro no campo e foco automático.
9. **Simulador da régua** (`AdminSimulator`): dry-run com fingerprint, fixação de
   relatório e a única tabela `ui/table` do projeto — prova que o padrão DataTable
   funciona aqui.
10. **Dark mode + pull-to-refresh + safe-area** no mobile: básico de app bem coberto.

---

## 5. COMPONENTES CANDIDATOS A PADRÃO OFICIAL

| Componente | Referência atual | Por quê |
|---|---|---|
| StatusBadge | `status-config.ts` + `InvoiceCard` | Fonte única já refinada, com ícone |
| KpiCard | Cards de estatística de `AdminInstallRequests` (idênticos aos do Dashboard cliente) | Padrão mais completo (ícone circular + valor + label) |
| PageHeader | Header padrão cliente (`text-xl font-medium` + subtítulo) | Padrão dominante (8 telas) |
| ConfirmDialog | `ConfirmDialog.tsx` | Prévia + spinner + bloqueio |
| DataTable | `ui/table` no `AdminSimulator` | Único uso funcional, provado |
| EmptyState | `ui/empty` (instalado) + padrões repetidos | Substitui 6 implementações |
| Formulários | `Landing.tsx` | Máscaras + CEP + aceite + honeypot |

---

## 6. INCONSISTÊNCIAS DO DESIGN SYSTEM (SÍNTESE)

1. **4 sistemas de badge de status**: `status-config.ts` (canônico faturas),
   `statusBadgeClass` + `typeLabels` + `installStatusInfo` no AdminDashboard,
   badges manuais em Referrals/AdminReferrals, badges de entrega em AdminMessages.
2. **5 tipografias de KPI** (ver tabela categoria Cards).
3. **4 padrões de header de página**.
4. **3 implementações de checkbox** (shadcn + 2 nativos).
5. **2 APIs de toast** (sonner direto vs `useToast`).
6. **3 padrões de filtro** (chips em Faturas, Tabs no log, Select no log admin).
7. **Larguras de conteúdo** de 4xl a 7xl sem regra.
8. **Cores semânticas implícitas** (emerald=ok, amber=atenção, red=erro, blue=info)
   escritas como classes cruas 200+ vezes.
9. **`rounded-sm/md/lg/full`** misturados sem critério documentado.
10. **Mesma ação com estilos de botão divergentes** entre telas admin.

---

## 7. COMPONENTES DUPLICADOS (extrair um oficial)

- StatusBadge (4 implementações)
- KpiCard (5 implementações)
- PageHeader (4 padrões)
- EmptyState (6 implementações)
- StaleDataBanner/offline banner (2 cópias — Dashboard e Invoices)
- `adminFetch`/`getAdminToken`/`withAdminToken` (11 cópias)
- Formatação de CPF/data (locais em AdminDashboard, AdminInstallRequests,
  Referrals + `lib/cpf`)
- Skeleton do Perfil (inline em Profile.tsx duplica `ProfileSkeleton`)
- Filtro de status (chips vs Tabs vs Select)

## 8. REDUNDÂNCIAS DE INTERFACE

- **Prejudiciais:** aprovar/recusar instalação em 2 telas com regras diferentes
  (dashboard sem confirmação; página com bulk/lightbox/impressão); branding com
  código morto no dashboard; skeleton duplo do Perfil; toasts em 2 APIs.
- **Úteis (manter):** "Sincronizar cobranças" em Dashboard e Mensagens (atalho de
  operação frequente); ações de copiar repetidas por fatura (produtividade); botão
  voltar em telas profundas (acessibilidade).

## 9. FLUXOS QUE PODEM SER SIMPLIFICADOS

1. **Disparar fila outbox**: 2 cliques a partir do dashboard (botão → dialog);
   mesma ação em Mensagens com estilo diferente — unificar num único lugar com
   atalho no outro.
2. **Consulta de cliente + lembrete**: exige navegar ao dashboard, preencher CPF,
   esperar resultado, clicar em "Lembrar", confirmar — uma página "Cliente 360"
   com busca global encurtaria o caminho.
3. **Aprovação de instalação**: hoje 2 experiências; padronizar na página
   dedicada com bulk e confirmação.
4. **Funil de engajamento**: escondido em Conexões, longe das outras métricas de
   mensagem.

## 10. TELAS QUE PODEM SER UNIFICADAS

- AdminDashboard → fatiar em: Dashboard (KPIs + atalhos), Auditoria (log),
  Cliente 360 (consulta + sessões + entregas).
- Conexões → manter credenciais; funil sai para Mensagens.

## 11. TELAS QUE TALVEZ POSSAM SER REMOVIDAS

- `AdminLogin.tsx` (redirect puro para /login — código morto útil apenas para
  links antigos).
- Rota `/admin/outbox` (já é redirect para /admin/messages — limpar no roadmap).
- Dead code: `LogoDropdown.tsx`, handlers de branding no AdminDashboard.

## 12. NOVAS TELAS SUGERIDAS (nascem de lacuna real)

**1. "Cliente 360" (admin)** — hoje consultar cliente, faturas dele, sessões e
entregas WhatsApp exigem 3 telas.
- *Quem:* atendimento. *Navegação:* `/admin/customers/:cpf` a partir da busca e de
  qualquer menção a CPF (audit log, outbox, sessões).
- *Informações:* dados cadastrais, faturas com StatusBadge oficial, histórico de
  entregas/cliques, sessões ativas, log do cliente.
- *Ações:* enviar lembrete (ConfirmDialog com prévia), revogar sessão, ajustar
  pontos.
- *Formato:* **página própria** (substitui o card "Consultar Cliente" + card
  "Sessões" do dashboard).

**2. Aba "Auditoria" (admin)** — o log de acessos/operação é hoje 40% do
AdminDashboard. *Formato:* página própria com FilterBar (scope, tipo, CPF,
período) e DataTable paginado.

**3. Central de Ajuda/Suporte (cliente)** — não existe lugar que diga "como falo
com a provedora". *Formato:* **seção do Perfil** (não página nova): WhatsApp/e-mail
da provedora, horário, link da régua de dúvidas de fatura. Configurável no
branding.

**4. Painel de funil consolidado** — mover o funil semanal de Conexões para
**aba dentro de Mensagens** ("Mensagens | Funil | Clique em botões") — os 3 dados
são do mesmo domínio. Não criar página nova.

**5. Estado "onboarding" do admin** — primeira entrada sem conexão configurada
mostra erros soltos; um empty state guiado ("1. Cadastre a conta MikWeb →
2. Conecte o WhatsApp → 3. Ative a régua") na Conexões/Régua resolve sem tela nova.

## 13. MELHORIAS DE RESPONSIVIDADE

- **Quebra real (P0-1):** bottom nav admin 8×64px. Padrão sugerido: ≤5 itens +
  "Mais".
- **Tabelas/listas admin** (`max-w-7xl`, 5+ colunas) em tablet/mobile: virar cards
  empilhados ou drawer de linha; ações em `DropdownMenu` (hoje botões espalhados
  na linha).
- **Modais grandes** (AdminSyncDialog 875 linhas, AdminDispatchDialog) em mobile:
  formulário longo deveria ser **Sheet/Drawer full-height** (primitivo instalado,
  zero usos).
- **Filtros** em Faturas: já empilham bem (`flex-col sm:flex-row`) — transformar
  em padrão `FilterBar` reutilizável.
- **KPI grids**: `grid-cols-2 sm:grid-cols-4` ok; em Mensagens são 5 cards →
  `2 col` deixa órfão (padronizar 4 ou wrap).
- **Sidebar**: `w-64` fixa; Mensagens com métricas + filtros + tabela merece
  collapse para `w-16` (ícones) opcional.

## 14. MELHORIAS DE ACESSIBILIDADE (diagnóstico)

- **Contraste:** `muted-foreground/50` na seção "Pagas" e `muted-foreground/60` em
  anos/valores fica abaixo de 3:1 — quebra WCAG AA para texto.
- **Micro-tipografia:** `text-[9px]`/`text-[10px]` em CPFs, valores e datas
  operacionais — ilegível para baixa visão.
- **Botões-ícone sem nome:** refresh (AdminDashboard ×3, InstallRequests),
  "Lembrar" parcialmente escondido em mobile (`hidden sm:inline`). Nenhum
  `Tooltip` (instalado, não usado) e 0 `aria-label` no AdminDashboard.
- **Navegação:** itens de menu são `<button>` sem `aria-current="page"`; sem
  skip-link; tabs do Radix compensam no AdminDashboard.
- **Teclado/foco:** shadcn garante anel de foco (`outline-ring/50`) e focus-trap
  nos modais — bom ponto de partida; manter ao substituir primitivos.
- **Cor:** status quase sempre tem ícone+texto (bom); exceção: badges de tipo no
  audit log dependem da cor para diferenciação fina (sky/teal/violet) — as 12
  categorias de cor não são distinguíveis por daltônicos.
- **Áreas de clique:** quick actions de fatura com `h-6`/`h-7` (~24–28px) < 44px
  recomendado em mobile.
- **Formulários:** Login/Settings com `Label htmlFor` correto; filtro de CPF do
  audit log só placeholder.

## 15. ESTRUTURA PROPOSTA PARA O DESIGN SYSTEM

**FOUNDATIONS** (definir em `index.css` + tailwind theme):
- **Colors:** manter monocromático + registrar os tons de status como tokens
  semânticos (`--status-success/warning/danger/info/neutral`) — hoje
  `emerald/amber/red/blue` cru.
- **Typography:** escala fixa (`display 20 medium`, `title 14 medium`, `body 14`,
  `caption 12`, `data 12 tabular`) — extingue 9–11px.
- **Spacing/Radius:** padronizar radius: `sm` para elementos internos,
  `rounded-lg` para cards/banners, `full` para avatares/badges-ponto.
- **Shadows:** regra "flat" do tema documentada (`shadow-sm` apenas no card
  destacado de ação pendente).
- **Breakpoints/Z-index/Motion:** tokens de z (sidebar 30, nav 50, overlay Radix
  default) e duração única de entrada (`slideUp 0.3s`); adicionar
  `prefers-reduced-motion` global.

**PRIMITIVES (usar o que já está instalado):** Button (+variantes
`success`/`whatsapp`), Input, InputGroup (busca), Select, Checkbox/Radio/Switch
(converter os 3 nativos), Textarea, Icon (lucide), Badge, Avatar.

**COMPONENTS (construir sobre os existentes):** Card, **StatusBadge** ←
status-config.ts, **KpiCard**, Modal (Dialog) + **Sheet/Drawer**, Dropdown,
**Tooltip** (começar pelos botões-ícone), Toast (sonner, API única), Alert ←
banners de Dashboard, Tabs, Breadcrumb (Voltar), **Pagination**, **DataTable** ←
padrão do Simulador, **FilterBar**, DatePicker (react-day-picker instalado, zero
usos), **EmptyState** ← ui/empty, LoadingState (skeleton/spinner), ErrorState (com
retry), ConfirmDialog (oficializar).

**PATTERNS:** formulário (máscaras + CEP + aceite), listagem (FilterBar +
DataTable + paginação + EmptyState), detalhe (PageHeader + grid 2 col), dashboard
(KpiRow + seções), filtros, ações em massa (seleção + barra de contexto),
confirmações (ConfirmDialog), edição/criação (Dialog ou Drawer por criticidade),
status de cobrança/entrega, feedback (toast + audit).

**LAYOUTS:** App shell (os dois layouts já espelhados viram `<AppShell>` único com
props de navegação), PageHeader (título+subtítulo+actions+badge), ContentContainer
(`max-w-*` por tipo de página), Grid, responsividade (sidebar → bottom nav ≤5
itens + "Mais").

---

## 16. ROADMAP RECOMENDADO

| Fase | Escopo | Entrega visível |
|---|---|---|
| **1 — Foundations & tokens** | Tokens de cor de status, escala tipográfica, radius/sombras documentados; `adminFetch` único em api-config | Zero mudança visual; dívida de 11 cópias eliminada |
| **2 — Componentes básicos** | StatusBadge, KpiCard, PageHeader, EmptyState, ErrorState, Tooltip nos ícones; converter checkboxes nativos | Badges idênticos em todas as telas |
| **3 — Componentes compostos** | DataTable + Pagination, FilterBar, Drawer para detalhes, Toast API única | Listas admin paginadas e padronizadas |
| **4 — Padronização das telas** | Fatiar AdminDashboard (Auditoria, Cliente 360); Referrals sem header duplo; funil → Mensagens; des-duplicar instalações | Menus coerentes com o conteúdo |
| **5 — UX e redundâncias** | Confirmação em aprovar/recusar; atalhos operacionais; remover dead code | Fluxo de operação sem armadilhas |
| **6 — Responsividade & a11y** | Bottom nav ≤5 + "Mais"; cards responsivos nas tabelas; contraste `/50`, piso tipográfico, aria-labels, `aria-current` | Painel usável no celular |
| **7 — Polimento** | Motion com reduced-motion, ripple escopado, 404 com ações, revisão dark mode | Acabamento |

Sequência proposital: cada fase não muda comportamento, só consolida — a Fase 4 só
é segura depois que 1–3 derem os componentes prontos para "trotar" as telas.

---

## ANEXO — INVENTÁRIO DE USO DOS PRIMITIVOS SHADCN

| Primitivo | Arquivos que usam | Primitivo | Arquivos que usam |
|---|---|---|---|
| badge | 12 | avatar | 0 |
| select | 9 | sheet | 0 |
| switch | 6 | drawer | 0 |
| dropdown-menu | 3 | tooltip | 0 |
| skeleton | 2 | empty | 0 |
| tabs | 2 | pagination | 0 |
| checkbox | 2 | breadcrumb | 0 |
| table | 1 | form | 0 |
| alert-dialog | 1 | popover | 0 |
| button | (base global) | progress | 0 |

*(medido via grep em `src/pages` e `src/components`, excluindo `components/ui`)*
