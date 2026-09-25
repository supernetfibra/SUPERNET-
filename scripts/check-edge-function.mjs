#!/usr/bin/env node
/**
 * Checa a Edge Function (`supabase/functions/api/index.ts`).
 *
 * Por que isto existe: `index.ts` importa de `esm.sh` e por isso não entra em nenhum
 * `tsconfig` — nenhum typecheck o cobre. Nesta sessão isso já custou um bug real: ao
 * trocar um parâmetro de configuração por outro, uma referência a `horizonDays` ficou
 * para trás e o `esbuild` empacotou normalmente (ele não faz análise semântica); o
 * erro só apareceria em produção, na criação do relatório de simulação.
 *
 * O que este script faz: empacota com o MESMO comando do deploy e roda
 * `tsc --checkJs` no bundle, procurando apenas a classe "nome não definido"
 * (TS2304/TS2552). `Deno` é global do runtime e não existe no `lib` do TypeScript, então
 * é esperado.
 *
 *   node scripts/check-edge-function.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ENTRY = "supabase/functions/api/index.ts";
const work = mkdtempSync(join(tmpdir(), "edge-check-"));
const bundle = join(work, "api-bundle.js");
// No Windows o `npx` é um `.cmd`, que o execFile não resolve sem shell.
const npx = (args, options) =>
  execFileSync("npx", args, { shell: process.platform === "win32", ...options });

let bundleSize = 0;
try {
  npx(
    ["esbuild", ENTRY, "--bundle", "--format=esm", "--platform=neutral", "--external:https://*", `--outfile=${bundle}`],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  bundleSize = readFileSync(bundle).length;
} catch {
  console.error("✗ a Edge Function não empacota — o deploy quebraria.");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

let output = "";
try {
  npx(
    [
      "tsc",
      "--allowJs",
      "--checkJs",
      "--noEmit",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      "--lib",
      "es2022,dom",
      resolve(bundle),
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (error) {
  output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
}

rmSync(work, { recursive: true, force: true });

const undefinedNames = output
  .split("\n")
  .filter((line) => line.includes("TS2304") || line.includes("TS2552"))
  .filter((line) => !/Cannot find name '(Deno|Deno\.[A-Za-z]+)'/.test(line))
  // Redeclaração de tipo no bundle conta como TS2300/TS2323, não entra aqui.
  .map((line) => line.replace(/^.*api-bundle\.js/, ENTRY));

if (undefinedNames.length) {
  console.error("✗ a Edge Function usa nomes que não existem (o deploy passaria e quebraria em runtime):\n");
  for (const line of undefinedNames) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`✓ Edge Function: empacota e não há nome indefinido (bundle de ${(bundleSize / 1024).toFixed(1)} kB).`);
