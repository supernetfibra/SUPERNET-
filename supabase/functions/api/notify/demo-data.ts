/**
 * Dados sintéticos e snapshots. Módulo puro (ver `model.ts`).
 *
 * Serve para dois casos concretos:
 *   1. validar as regras **antes** de ter credencial da MikWeb (e sem tocar em
 *      produção) — o cenário `realistic` existe só para isso;
 *   2. what-if: "e se entrarem 5.000 faturas no mesmo dia?" — o cenário `stress`
 *      mostra onde a cota de novas conversas quebra.
 *
 * A base é **determinística** (PRNG com semente fixa): rodar duas vezes dá o mesmo
 * relatório, o que é requisito para comparar duas configurações de regra.
 * Nomes são fictícios; CPFs são apenas numéricos, não de pessoas reais.
 */

import { addDays, civilToday, type RawBilling, type RawCustomer } from "./model.ts";
import type { SimulationContact } from "./simulate.ts";

export type DemoScenario = "realistic" | "stress" | "edge";

export interface DemoBase {
  customers: RawCustomer[];
  billings: RawBilling[];
  pushCustomerIds: string[];
  contacts: SimulationContact[];
  assumptions: string[];
}

// ---------------------------------------------------------------------------
// PRNG determinístico (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João",
  "Karina", "Lucas", "Mariana", "Nelson", "Olívia", "Paulo", "Queila", "Rafael", "Sônia", "Tadeu",
  "Ursula", "Vanessa", "Wesley", "Xênia", "Yara", "Zélia",
];
const LAST_NAMES = [
  "Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Ferreira", "Gomes", "Henriques", "Ibrahim", "Junqueira",
  "Klein", "Lima", "Moraes", "Nogueira", "Oliveira", "Pereira", "Queiroz", "Ribeiro", "Santos", "Teixeira",
];

const SITUATION_OPEN = ["Em Aberto", "Em Atraso", "Vencido"];
const SITUATION_PAID = ["Pago", "Efetuado"];
const SITUATION_CANCELED = ["Cancelado"];
const SITUATION_UNKNOWN = ["Em Análise", "Aguardando Baixa", ""];

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length) % list.length]!;
}

function digits(rand: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(Math.floor(rand() * 10));
  return out;
}

/**
 * Base64 para ASCII sem depender de `Buffer` (Node) nem de `btoa` (Deno/Node ≥16) —
 * este módulo precisa rodar nos dois runtimes.
 */
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i) & 0xff;
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) & 0xff : null;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) & 0xff : null;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === null ? "=" : B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === null ? "=" : B64_ALPHABET[c & 0x3f];
  }
  return out;
}

function makePhone(rand: () => number): string {
  const ddd = 11 + Math.floor(rand() * 19);
  return `55${ddd}9${digits(rand, 8)}`;
}

interface DemoOptions {
  scenario?: DemoScenario;
  customers?: number;
  today?: string;
  seed?: number;
}

export function generateDemoBase(options: DemoOptions = {}): DemoBase {
  const scenario = options.scenario ?? "realistic";
  const today = options.today ?? civilToday();
  const seed = options.seed ?? (scenario === "stress" ? 4242 : scenario === "edge" ? 7 : 20260626);
  const defaultCustomers = scenario === "stress" ? 5000 : scenario === "edge" ? 120 : 400;
  const total = Math.max(1, options.customers ?? defaultCustomers);
  const rand = mulberry32(seed);

  const customers: RawCustomer[] = [];
  const billings: RawBilling[] = [];
  const pushCustomerIds: string[] = [];
  const contacts: SimulationContact[] = [];
  let billingSeq = 100000;

  for (let index = 0; index < total; index++) {
    const id = String(900000 + index);
    const name = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)} ${pick(rand, LAST_NAMES)}`;
    const customer: RawCustomer = {
      id,
      full_name: name,
      cpf_cnpj: digits(rand, 11),
      status: "active",
    };

    // --- telefone: a maior fonte de falha real de envio ----------------------
    const phoneRoll = rand();
    if (scenario === "edge") {
      if (phoneRoll < 0.2) customer.phone_number = "0";
      else if (phoneRoll < 0.4) customer.cell_phone_number_1 = "551198765";
      else if (phoneRoll < 0.6) customer.cell_phone_number_1 = `5500987654321`;
      else if (phoneRoll < 0.8) customer.phone_number = "1133214455";
      else customer.cell_phone_number_1 = makePhone(rand);
    } else if (phoneRoll < 0.88) {
      customer.cell_phone_number_1 = makePhone(rand);
    } else if (phoneRoll < 0.92) {
      customer.phone_number = "1133214455"; // fixo
    } else if (phoneRoll < 0.96) {
      // sem telefone
    } else {
      customer.cell_phone_number_1 = `55${11 + Math.floor(rand() * 5)}98765`; // truncado
    }

    const customerStatusRoll = rand();
    if (scenario === "edge") customer.status = customerStatusRoll < 0.3 ? "Bloqueado" : "active";
    else if (customerStatusRoll < 0.05) customer.status = "Bloqueado";
    else if (customerStatusRoll < 0.08) customer.status = "Cancelado";

    customers.push(customer);

    // --- alcance por canal ---------------------------------------------------
    const hasValidPhone = Boolean(customer.cell_phone_number_1);
    if (rand() < (scenario === "stress" ? 0.3 : 0.32)) pushCustomerIds.push(id);

    const optInRoll = rand();
    if (scenario === "stress") {
      if (optInRoll < 0.85) contacts.push({ customerId: id, optIn: true, phone: null, hasConversation: rand() < 0.15 });
    } else if (scenario === "edge") {
      if (optInRoll < 0.5) contacts.push({ customerId: id, optIn: true, phone: null, hasConversation: false });
    } else if (optInRoll < 0.55) {
      contacts.push({
        customerId: id,
        optIn: true,
        phone: hasValidPhone ? null : "5511987654321", // 8% dos opt-in vêm sem celular válido no cadastro
        hasConversation: rand() < 0.25,
      });
    } else if (optInRoll < 0.58) {
      contacts.push({ customerId: id, optIn: false, phone: null }); // optou por sair
    }

    // --- faturas -------------------------------------------------------------
    const count = scenario === "stress" ? 1 + Math.floor(rand() * 2) : Math.floor(rand() * 4);
    for (let n = 0; n < count; n++) {
      const statusRoll = rand();
      let situation: string;
      if (scenario === "edge") {
        situation = statusRoll < 0.25 ? pick(rand, SITUATION_UNKNOWN) : pick(rand, SITUATION_OPEN);
      } else if (statusRoll < 0.72) {
        situation = pick(rand, SITUATION_OPEN);
      } else if (statusRoll < 0.94) {
        situation = pick(rand, SITUATION_PAID);
      } else if (statusRoll < 0.97) {
        situation = pick(rand, SITUATION_CANCELED);
      } else {
        situation = pick(rand, SITUATION_UNKNOWN);
      }

      // Vencimentos espalhados de -30 a +12 dias; o cenário `stress` concentra
      // todos perto do vencimento para estourar a cota de novas conversas.
      const spread = scenario === "stress" ? -2 + Math.floor(rand() * 5) : -30 + Math.floor(rand() * 43);
      const dueDate = addDays(today, spread);
      const isLate = spread < 0 && situation !== "Pago" && situation !== "Efetuado";
      const base = 89.9 + Math.floor(rand() * 16) * 10;

      const billing: RawBilling = {
        id: billingSeq++,
        customer_id: id,
        reference: `${today.slice(0, 4)}${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}`,
        due_day: scenario === "edge" && rand() < 0.15 ? "2026-13-45" : dueDate,
        value: scenario === "edge" && rand() < 0.2 ? 0 : Number(base.toFixed(2)),
        situation_name: situation,
        date_payment: situation === "Pago" || situation === "Efetuado" ? addDays(dueDate, -1) : null,
      };

      if (isLate && rand() < 0.6) {
        billing.fine_amount = Number((base * 0.02).toFixed(2));
        billing.interest_amount = Number((base * 0.0033 * Math.abs(spread)).toFixed(2));
      }
      // metade dos casos no campo base64 (como a MikWeb devolve de verdade) e
      // metade já em texto puro — exercita os dois caminhos de findPixRaw().
      if (rand() < 0.7) {
        const code = `00020126580014BR.GOV.BCB.PIX0136sintetico-${billing.id}5204000053039865802BR5913MINHASUPERNET6009SAO PAULO62070503***6304AB1C`;
        if (rand() < 0.5) billing.pix_copy_paste_base64 = base64Encode(code);
        else billing.pix_copy_paste = code;
      }
      if (rand() < 0.5) billing.url_boleto = `https://boleto.example.com.br/${billing.id}.pdf`;
      billing.digitable_line = `34191.79001 01043.510047 91020.150008 ${Math.floor(rand() * 9)} ${Math.floor(rand() * 90000000000)}`;

      billings.push(billing);
    }
  }

  return {
    customers,
    billings,
    pushCustomerIds,
    contacts,
    assumptions: [
      `base sintética (cenário "${scenario}", semente determinística, ${total} clientes) — nenhum dado real`,
      "nomes são fictícios e os CPFs são apenas sequências numéricas",
    ],
  };
}

// ---------------------------------------------------------------------------
// Snapshot — permite rodar o simulador sobre um extrato da base real
// ---------------------------------------------------------------------------

export interface Snapshot {
  generatedAt?: string;
  customers?: RawCustomer[];
  billings?: RawBilling[];
  pushCustomerIds?: string[];
  whatsappContacts?: SimulationContact[];
}

export interface SnapshotParseResult {
  ok: boolean;
  base: DemoBase;
  errors: string[];
}

/**
 * Aceita tanto o objeto completo quanto um array solto de faturas (para um
 * what-if rápido com o JSON que o admin já tem à mão).
 */
export function parseSnapshot(input: unknown): SnapshotParseResult {
  const errors: string[] = [];
  let snapshot: Snapshot;

  if (Array.isArray(input)) {
    snapshot = { billings: input as RawBilling[] };
  } else if (input && typeof input === "object") {
    snapshot = input as Snapshot;
  } else {
    return { ok: false, base: emptyBase(), errors: ["snapshot deve ser um objeto ou um array de faturas"] };
  }

  const billings = Array.isArray(snapshot.billings) ? snapshot.billings : [];
  const customers = Array.isArray(snapshot.customers) ? snapshot.customers : [];

  if (!billings.length) errors.push("snapshot sem faturas (`billings`)");
  if (!customers.length) errors.push("snapshot sem clientes (`customers`) — nomes e telefones não serão resolvidos");

  const contacts = Array.isArray(snapshot.whatsappContacts) ? snapshot.whatsappContacts : [];
  const pushCustomerIds = Array.isArray(snapshot.pushCustomerIds) ? snapshot.pushCustomerIds.map(String) : [];

  const assumptions = [`snapshot carregado${snapshot.generatedAt ? ` (gerado em ${snapshot.generatedAt})` : ""}`];
  if (!contacts.length) assumptions.push("snapshot sem `whatsappContacts`: assumido que ninguém tem opt-in de WhatsApp");
  if (!pushCustomerIds.length) assumptions.push("snapshot sem `pushCustomerIds`: assumido que ninguém tem inscrição push");

  return {
    ok: errors.length === 0,
    base: { customers, billings, pushCustomerIds, contacts, assumptions },
    errors,
  };
}

function emptyBase(): DemoBase {
  return { customers: [], billings: [], pushCustomerIds: [], contacts: [], assumptions: [] };
}
