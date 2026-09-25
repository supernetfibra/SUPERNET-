#!/usr/bin/env node
/**
 * Verificação das migrations de notificação contra um Postgres DE VERDADE.
 *
 * Existe porque `npm run check:notify` prova o núcleo TypeScript, mas o SQL não: as
 * garantias de "não enviar duas vezes" (`enqueue_notification`) e de "não estourar a
 * cota" (`reserve_new_chat_slot`) moram em plpgsql, e plpgsql só falha em tempo de
 * execução. Foi exatamente o que aconteceu: `enqueue_notification` recusava TODA
 * cobrança com "column reference is ambiguous" — erro que nenhum typecheck pegaria e
 * que apareceria na primeira fatura enviada em produção.
 *
 * Roda em PGlite (Postgres em WebAssembly, sem Docker e sem daemon), aplicando as
 * migrations 003 → 005 na ordem e exercitando cada garantia:
 *
 *   1. migrations aplicam (é o teste mais barato e o mais valioso)
 *   2. enfileiramento idempotente (dedupe_key repetida não cria evento nem entrega)
 *   3. claim/release (SKIP LOCKED, attempts, status_at)
 *   4. reserva de vaga para conversa nova (cota, idempotência da reserva)
 *   5. conversa já aberta não consome vaga (a mesma regra do simulador)
 *   6. fronteira do dia civil (webhook de hoje não conta envio de ontem)
 *   7. devolução à fila / falha libera a vaga
 *   8. cota 0 = sem teto (igual ao simulador) e cap nulo não vira bloqueio total
 *
 * Uso:  node scripts/check-notifications-sql.mjs   (ou `npm run check:sql`)
 *       Requer `@electric-sql/pglite` em devDependencies.
 *
 * O Supabase fornece alguns pré-requisitos que o PGlite não tem (extensão de UUID e
 * `auth`); eles são criados aqui, só para o teste rodar. Nada disso é migration.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = ["003_notifications.sql", "004_notification_settings.sql", "005_new_chat_quota.sql"];

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.log("⚠ verificação de SQL PULADA: instale com `npm i -D @electric-sql/pglite`");
  process.exit(0);
}

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else failures.push(`${name}${extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
function section(title) {
  console.log(`\n  ${title}`);
}

const db = new PGlite();

// Pré-requisitos do Supabase ausentes no PGlite (não são migration).
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;
  CREATE TABLE mikweb_audit_log (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), type TEXT, created_at BIGINT);
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

// O lock de canal é o que impede dois crons de estourarem o teto juntos; ele precisa
// existir e ser chamável dentro de uma transação (o RPC do Supabase é uma).
try {
  await db.exec(`SELECT pg_advisory_xact_lock(hashtext('notify:new_chat:whatsapp'))`);
  check("pg_advisory_xact_lock existe e roda", true);
} catch (error) {
  check("pg_advisory_xact_lock existe e roda", false, String(error.message ?? error));
}

const T0 = 1_800_000_000_000; // dia de referência (ms)
const YESTERDAY = T0 - 86_400_000;
let sequence = 0;

async function enqueue(dedupeKey, target) {
  sequence++;
  const { rows } = await db.query(
    `SELECT * FROM enqueue_notification($1,$2,$3,NULL,$4::jsonb,'marketing','whatsapp',$5,NULL,$6)`,
    ["billing.due_soon", dedupeKey, `c${sequence}`, {}, target, T0]
  );
  return rows[0];
}

const claimAll = () => db.exec(`SELECT claim_notification_deliveries(50,'whatsapp',${T0})`);
const slot = async (deliveryId, cap, dayStart = T0) =>
  (await db.query(`SELECT * FROM reserve_new_chat_slot($1,'whatsapp',$2,$3)`, [deliveryId, cap, dayStart])).rows[0];
const setStatus = (deliveryId, status, sentAt) =>
  db.exec(
    `UPDATE notification_deliveries SET status='${status}', sent_at=${sentAt ?? "NULL"}, status_at=${T0} WHERE id='${deliveryId}'`
  );
/** A mesma contagem que a função faz, lida direto da tabela (o número que governa). */
const usedNow = async () =>
  Number(
    (
      await db.query(
        `SELECT COUNT(*)::int AS n FROM notification_deliveries
          WHERE channel='whatsapp' AND new_chat
            AND status IN ('sending','sent','delivered','read')
            AND COALESCE(sent_at, status_at) >= ${T0}`
      )
    ).rows[0].n
  );
/** A função reporta o mesmo número que ela usa para decidir. */
const slotIsCoherent = async (result, label) => check(`${label}: o número reportado é o que governa`, result.used_today === (await usedNow()), { reported: result.used_today, stored: await usedNow() });

// ---------------------------------------------------------------------------
section("2. Enfileiramento idempotente");

const first = await enqueue("billing:1:due_day", "5511900000001");
const again = await enqueue("billing:1:due_day", "5511900000001");
eq("1ª chamada cria o evento", [first.created, Boolean(first.event_id)], [true, true]);
eq("2ª chamada com a mesma dedupe_key NÃO cria", again.created, false);
eq("e aponta para o mesmo evento", again.event_id, first.event_id);
eq("e não cria uma segunda entrega", again.delivery_id, null);
eq("nenhum evento duplicado na tabela", Number((await db.query(`SELECT COUNT(*)::int AS n FROM notification_events`)).rows[0].n), 1);

// ---------------------------------------------------------------------------
section("3. Claim e release");

const claimed = (await db.query(`SELECT * FROM claim_notification_deliveries(50,'whatsapp',${T0})`)).rows;
eq("claim reserva a entrega devida", [claimed.length, claimed[0].status, claimed[0].attempts], [1, "sending", 1]);
eq("claim grava status_at (a cota depende dele)", Number(claimed[0].status_at), T0);
eq("claim não reserva duas vezes a mesma entrega", (await db.query(`SELECT * FROM claim_notification_deliveries(50,'whatsapp',${T0})`)).rows.length, 0);
await db.exec(`SELECT release_notification_delivery('${first.delivery_id}', ${T0}, 'verificação')`);
const released = (await db.query(`SELECT status, attempts FROM notification_deliveries WHERE id='${first.delivery_id}'`)).rows[0];
eq("release devolve para a fila e desfaz a tentativa", [released.status, released.attempts], ["queued", 0]);

// ---------------------------------------------------------------------------
section("4. Reserva de vaga para conversa nova (cota 2)");

const n1 = await enqueue("billing:2:due_day", "5511900000002");
const n2 = await enqueue("billing:3:due_day", "5511900000003");
const n3 = await enqueue("billing:4:due_day", "5511900000004");
await claimAll();

const s1 = await slot(n1.delivery_id, 2);
eq("1ª conversa nova: liberada", [s1.allowed, s1.is_new_chat, s1.used_today, s1.cap], [true, true, 1, 2]);
await slotIsCoherent(s1, "1ª reserva");

const s2 = await slot(n2.delivery_id, 2);
eq("2ª conversa nova: liberada (última da cota)", [s2.allowed, s2.used_today], [true, 2]);

const s3 = await slot(n3.delivery_id, 2);
eq("3ª conversa nova: BARRADA pela cota do dia", [s3.allowed, s3.is_new_chat, s3.used_today], [false, true, 2]);
eq(
  "entrega barrada NÃO fica marcada como conversa nova",
  (await db.query(`SELECT new_chat FROM notification_deliveries WHERE id='${n3.delivery_id}'`)).rows[0].new_chat,
  false
);

const s1again = await slot(n1.delivery_id, 2);
eq("re-reservar a mesma entrega não consome uma 2ª vaga", [s1again.allowed, s1again.used_today], [true, 2]);

// ---------------------------------------------------------------------------
section("5. Conversa já aberta não consome vaga");

await setStatus(n1.delivery_id, "sent", T0);
const reopened = await enqueue("billing:5:due_day", "5511900000002"); // MESMO destino do n1
await claimAll();
const sReopened = await slot(reopened.delivery_id, 999);
eq("destino que já recebeu não é conversa nova", [sReopened.allowed, sReopened.is_new_chat], [true, false]);
eq("…e não aumenta a contagem do dia", sReopened.used_today, 2);

// ---------------------------------------------------------------------------
section("6. Fronteira do dia civil");

const n5 = await enqueue("billing:6:due_day", "5511900000005");
await claimAll();
const squeezed = await slot(n5.delivery_id, 1);
eq("cota 1 com duas conversas no dia: barra", [squeezed.allowed, squeezed.used_today], [false, 2]);

// Webhook de HOJE sobre um envio de ONTEM: não pode virar conversa de hoje.
await setStatus(n2.delivery_id, "delivered", YESTERDAY);
eq("webhook de hoje não arrasta envio de ontem para o dia de hoje", await usedNow(), 1);
const afterWebhook = await slot(n5.delivery_id, 2);
eq("e a vaga que sobrou é usada", [afterWebhook.allowed, afterWebhook.used_today], [true, 2]);

// ---------------------------------------------------------------------------
section("7. O que volta para a fila (ou falha) libera a vaga");

await db.exec(`SELECT release_notification_delivery('${n5.delivery_id}', ${T0}, 'cota')`);
eq("entrega devolvida à fila não conta mais no dia", await usedNow(), 1);
const reReserved = await slot(n5.delivery_id, 999);
eq("reenvio do mesmo aviso não consome uma segunda vaga", [reReserved.allowed, reReserved.is_new_chat, reReserved.used_today], [true, true, 1]);
await setStatus(n5.delivery_id, "failed", null);
eq("envio que falhou não consome a cota do dia", await usedNow(), 1);

// ---------------------------------------------------------------------------
section("8. Cota 0 e cota nula");

const n6 = await enqueue("billing:7:due_day", "5511900000006");
await claimAll();
const unlimited = await slot(n6.delivery_id, 0);
eq("cota 0 = sem teto (igual ao simulador)", [unlimited.allowed, unlimited.is_new_chat, unlimited.used_today], [true, true, 2]);
const nullCap = await slot(n6.delivery_id, null);
eq("cota nula também é sem teto, não bloqueio total", [nullCap.allowed, nullCap.cap], [true, 0]);
const ghost = await slot("00000000-0000-0000-0000-000000000000", 1);
eq("entrega inexistente não bloqueia (nem explode)", ghost.allowed, true);

// ---------------------------------------------------------------------------

console.log(`\n${failures.length === 0 ? "✓" : "✗"} ${pass} verificações de SQL passaram, ${failures.length} falharam`);
for (const item of failures) console.log(`  ✗ ${item}`);
process.exit(failures.length === 0 ? 0 : 1);
