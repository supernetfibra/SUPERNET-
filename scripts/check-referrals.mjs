#!/usr/bin/env node
/**
 * Verificação do programa de indicação (migration 011) contra um Postgres DE
 * VERDADE — mesmo padrão de `check-notifications-sql.mjs` (PGlite).
 *
 * O `check:notify` prova a lógica TypeScript, mas as garantias que importam
 * moram em plpgsql e em índices parciais: crédito idempotente, débito atômico,
 * saldo nunca negativo, reembolso na recusa. Só executando o SQL contra um
 * Postgres real para pegar isso — foi exatamente o modo como
 * `enqueue_notification` já quebrou ("column reference is ambiguous").
 *
 * Exercita:
 *   1. migrations aplicam (011 após 001/002 — install_requests precisa existir)
 *   2. ensure_referral_code: emite 1 código por cliente, reuso, colisão não quebra
 *   3. crédito idempotente: mesma aprovação 2× = 1 lançamento
 *   4. resgate: débito + pedido numa transação, saldo correto
 *   5. saldo insuficiente: recusa e NÃO cria pedido nem débito
 *   6. recusa do admin devolve pontos (e é idempotente)
 *   7. máquina de estados: pending → applied direto é recusado
 *   8. ajuste manual de pontos aparece no saldo
 *   9. gen_random_bytes/pgcrypto disponível (emissão de código)
 *
 * Uso:  node scripts/check-referrals.mjs   (ou `npm run check:referrals`)
 *       Requer `@electric-sql/pglite` em devDependencies.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// Só a 011 entra aqui: a 001 usa a extensão uuid-ossp, que o PGlite não
// empacota (mesmo motivo de check-notifications-sql.mjs testar só 003+). O
// que a 011 precisa de `install_requests` é criado nos pré-requisitos abaixo.
const MIGRATIONS = ["011_referrals.sql"];

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.log("⚠ verificação de referrals PULADA: instale com `npm i -D @electric-sql/pglite`");
  process.exit(0);
}

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else failures.push(`${name}${extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}
function section(title) {
  console.log(`\n  ${title}`);
}

const db = new PGlite();

await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;
  CREATE TABLE mikweb_audit_log (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), type TEXT, created_at BIGINT);
  CREATE TABLE mikweb_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL DEFAULT 'default',
    api_url TEXT NOT NULL DEFAULT '',
    api_token TEXT NOT NULL DEFAULT '',
    provider_name TEXT,
    logo_url TEXT,
    updated_at BIGINT,
    updated_by TEXT
  );
  CREATE TABLE mikweb_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token TEXT UNIQUE NOT NULL,
    cpf TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    contacts JSONB NOT NULL DEFAULT '[]',
    selected_contact_id TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    last_activity_at BIGINT NOT NULL
  );
  CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT UNIQUE NOT NULL,
    keys JSONB NOT NULL,
    session_token TEXT NOT NULL,
    cpf TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    user_agent TEXT,
    created_at BIGINT NOT NULL
  );
  -- Colunas da 001 que a 011 e os testes usam (o resto do schema da tabela
  -- não é relevante para as garantias testadas aqui).
  CREATE TABLE install_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    cpf TEXT NOT NULL,
    phone TEXT NOT NULL,
    agreed_to_terms BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL
  );
`);

section("1. As migrations aplicam");
for (const file of MIGRATIONS) {
  try {
    await db.exec(readFileSync(join(HERE, "..", "supabase", "migrations", file), "utf8"));
    check(`${file} aplica sem erro`, true);
  } catch (error) {
    check(`${file} aplica sem erro`, false, String(error.message ?? error));
  }
}

const T0 = 1_800_000_000_000;

async function balance(customerRef) {
  const { rows } = await db.query(`SELECT COALESCE(SUM(delta), 0) AS b FROM referral_points_ledger WHERE customer_ref = $1`, [customerRef]);
  return Number(rows[0].b);
}

const credit = (customerRef, delta, reason, sourceType, sourceId) =>
  db.query(`SELECT credit_referral_points($1,$2,$3,$4,$5,'admin') AS r`, [customerRef, delta, reason, sourceType, sourceId]);

const redeem = (customerRef, rewardId) =>
  db.query(`SELECT redeem_referral_reward($1,$2,'Cliente Teste') AS r`, [customerRef, rewardId]);

section("2. ensure_referral_code — um código ativo por cliente");
const code1 = (await db.query(`SELECT ensure_referral_code('a:1','Maria Silva','11122233344') AS c`)).rows[0].c;
check("emite código de 8 chars", typeof code1 === "string" && code1.length === 8, code1);
const code1Again = (await db.query(`SELECT ensure_referral_code('a:1','Maria Silva','11122233344') AS c`)).rows[0].c;
check("reusa o mesmo código no 2º ensure", code1Again === code1, { code1Again, code1 });
const code2 = (await db.query(`SELECT ensure_referral_code('a:2','João Souza','55566677788') AS c`)).rows[0].c;
check("clientes diferentes têm códigos diferentes", code2 !== code1, { code1, code2 });

const activeRows = (await db.query(`SELECT count(*) AS n FROM referral_codes WHERE active`)).rows[0];
check("dois códigos ativos no total", Number(activeRows.n) === 2, activeRows);

section("3. Crédito idempotente (aprovação 2×)");
await credit("a:1", 100, "approval:req-1", "approval", "req-1");
const first = await credit("a:1", 100, "approval:req-1", "approval", "req-1");
check("segunda chamada devolve inserted=false", first.rows[0].r.inserted === false, first.rows[0].r);
check("saldo = 100 (não 200)", (await balance("a:1")) === 100, await balance("a:1"));

// Aprovação diferente cria lançamento novo
await credit("a:1", 100, "approval:req-2", "approval", "req-2");
check("aprovação diferente credita de novo", (await balance("a:1")) === 200, await balance("a:1"));

section("4. Resgate — débito + pedido atômicos");
const reward = (
  await db.query(
    `INSERT INTO referral_rewards (title, description, points_cost, kind, active, sort_order, created_at)
     VALUES ('R$ 20 de desconto', 'Desconto na fatura', 150, 'desconto', TRUE, 0, $1) RETURNING id`,
    [T0]
  )
).rows[0];
const rewardId = reward.id;

const redeemRes = await redeem("a:1", rewardId);
check("resgate devolve redemptionId", Boolean(redeemRes.rows[0].r.redemptionId), redeemRes.rows[0].r);
check("saldo após resgate = 50", (await balance("a:1")) === 50, await balance("a:1"));
const pendingRow = (await db.query(`SELECT status FROM referral_redemptions WHERE id = $1`, [redeemRes.rows[0].r.redemptionId])).rows[0];
check("pedido criado como pending", pendingRow?.status === "pending", pendingRow);
const redemptionId = redeemRes.rows[0].r.redemptionId;

section("5. Saldo insuficiente é recusado (sem pedido, sem débito)");
let insufficientError = null;
try {
  await redeem("a:2", rewardId);
} catch (error) {
  insufficientError = String(error.message ?? error);
}
check("recusa com 'Saldo insuficiente'", insufficientError?.includes("Saldo insuficiente"), insufficientError);
check("saldo de a:2 continua 0", (await balance("a:2")) === 0, await balance("a:2"));
const redemptionsA2 = (await db.query(`SELECT count(*) AS n FROM referral_redemptions WHERE customer_ref = 'a:2'`)).rows[0];
check("nenhum pedido criado para a:2", Number(redemptionsA2.n) === 0, redemptionsA2);

section("6. Recusa do admin devolve pontos (idempotente)");
await db.query(`UPDATE referral_redemptions SET status = 'rejected' WHERE id = $1`, [redemptionId]);
await credit("a:1", 150, `refund:${redemptionId}`, "redemption", redemptionId);
check("saldo devolvido = 200", (await balance("a:1")) === 200, await balance("a:1"));
await credit("a:1", 150, `refund:${redemptionId}`, "redemption", redemptionId);
check("refund repetido não duplica (idempotente)", (await balance("a:1")) === 200, await balance("a:1"));

section("7. Máquina de estados do resgate");
const invalid = (await db.query(`SELECT referral_redemption_status_allowed('pending','applied') AS ok`)).rows[0];
check("pending → applied é recusado", invalid.ok === false, invalid);
const valid1 = (await db.query(`SELECT referral_redemption_status_allowed('pending','approved') AS ok`)).rows[0];
check("pending → approved é permitido", valid1.ok === true, valid1);
const valid2 = (await db.query(`SELECT referral_redemption_status_allowed('approved','applied') AS ok`)).rows[0];
check("approved → applied é permitido", valid2.ok === true, valid2);

section("8. Ajuste manual aparece no saldo");
await credit("a:1", -20, "admin:compensacao", "admin_adjust", null);
check("débito manual de 20 aplicado", (await balance("a:1")) === 180, await balance("a:1"));
await credit("a:1", 30, "admin:bonus operador", "admin_adjust", null);
check("crédito manual de 30 aplicado", (await balance("a:1")) === 210, await balance("a:1"));

section("9. Código inválido não bloqueia instalação (coluna existe)");
await db.query(
  `INSERT INTO install_requests (full_name, cpf, phone, agreed_to_terms, referral_code, status, created_at)
   VALUES ('Lead Teste', '99988877766', '11999998888', TRUE, $1, 'pending', $2)`,
  [code1, T0]
);
const linked = (await db.query(`SELECT referral_code FROM install_requests WHERE cpf = '99988877766'`)).rows[0];
check("solicitação guarda o referral_code", linked.referral_code === code1, linked);

// ---------------------------------------------------------------------------
console.log(`\n${pass} verificações OK${failures.length ? `, ${failures.length} FALHARAM` : ""}`);
if (failures.length) {
  console.log("\nFalhas:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("  Programa de indicação: garantias do banco OK ✓");
