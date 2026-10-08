/**
 * Health score do canal — módulo puro.
 *
 * O dono do provedor não deveria precisar saber Onde vivem as coisas (credenciais,
 * instância, webhook, régua, opt-ins) para saber SE o canal vai entregar hoje.
 * Este módulo transforma uma lista de checagens numa nota 0–100 e num checklist
 * com o que falta fazer — o endpoint `/admin/whatsapp/health` coleta as checagens,
 * o painel só apresenta.
 *
 * Regra de apresentação que mora aqui (para painel e futuro não divergirem):
 *   - checagens CRÍTICAS quebradas derrubam o `ok` do relatório, mesmo com nota
 *     alta (75/100 com credencial ausente é um canal que NÃO envia);
 *   - checagens informacionais (números de fila, incertos) não penalizam a nota:
 *     descrevem operação, não saúde do canal.
 */

export interface HealthCheck {
  /** Chave estável — o painel usa para ícones e links. */
  key: string;
  label: string;
  ok: boolean;
  /** Onde resolver, quando não ok (rota do painel). */
  fix?: string;
  detail?: string;
  /** Quebrada = o canal não entrega, independentemente da nota. */
  critical?: boolean;
  /** Descreve operação (contagens) sem entrar na nota. */
  informational?: boolean;
}

export interface HealthReport {
  /** Todos os críticos ok — é o "posso confiar no canal hoje". */
  ok: boolean;
  /** 0–100 entre as checagens que pontuam (as informacionais ficam de fora). */
  score: number;
  checks: HealthCheck[];
  /** Frase pronta para o card do painel. */
  summary: string;
}

export function computeWhatsAppHealth(checks: HealthCheck[]): HealthReport {
  const scoring = checks.filter((c) => !c.informational);
  const passed = scoring.filter((c) => c.ok).length;
  const score = scoring.length ? Math.round((passed / scoring.length) * 100) : 100;
  const criticalsOk = checks.filter((c) => c.critical).every((c) => c.ok);
  const pending = scoring.filter((c) => !c.ok);

  // `ok` = só os críticos: é o "o canal entrega hoje?". Pendência não-crítica
  // (ex.: secret do webhook ausente) vira aviso no painel, não bloqueio.
  let summary: string;
  if (pending.length === 0) summary = "Canal saudável — tudo verificado";
  else if (!criticalsOk) summary = `Canal bloqueado: ${pending.length === 1 ? pending[0]!.label.toLowerCase() : `${pending.length} itens críticos`}`;
  else if (pending.length === 1) summary = `Quase tudo certo — falta ${pending[0]!.label.toLowerCase()}`;
  else summary = `${score}/100 — ${pending.length} itens para revisar`;

  return { ok: criticalsOk, score, checks, summary };
}
