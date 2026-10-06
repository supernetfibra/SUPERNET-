/**
 * Microcopy — concordância de número (FASE 6, item 8).
 *
 * Substitui construções como "1 item(ns) da seleção fica(m) de fora" por
 * "1 item ficará de fora" / "3 itens ficarão de fora".
 *
 * O verbo entra DENTRO da frase: assim a concordância fica explícita no ponto
 * de uso e não existe estado intermediário ("1 item fica(m)") que alguém possa
 * esquecer de corrigir. Para frases montadas em JSX, use `verb()`.
 */

/** "1 mensagem" / "3 mensagens" —olve o plural. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Só a forma verbal, quando a frase é composta em JSX ao redor do número.
 * `verb(1, "fica", "ficam")` → "fica".
 */
export function verb(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}