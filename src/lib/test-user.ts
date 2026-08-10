/**
 * Test User Module — fornece dados mockados para testes em preview/desenvolvimento
 * sem precisar da API MikWeb real ou deploy no Convex.
 *
 * CPF de teste: 12345678909
 * Senha: 1234 (4 primeiros dígitos do CPF)
 */

const TEST_CPFS = ["12345678909"];
const TEST_SESSION_KEY = "mikweb_test_session";

interface TestSession {
  cpf: string;
  customerId: string;
  customerName: string;
  email: string;
  createdAt: number;
}

export function isTestCpf(cpf: string): boolean {
  return TEST_CPFS.includes(cpf.replace(/\D/g, ""));
}

export function validateTestPassword(cpf: string, password: string): boolean {
  const normalizedCpf = cpf.replace(/\D/g, "");
  const normalizedPassword = password.replace(/\D/g, "");
  const first4Cpf = normalizedCpf.slice(0, 4);
  return first4Cpf === normalizedPassword;
}

export function getTestCustomerData() {
  return {
    id: 999,
    full_name: "Usuário Teste",
    login: "teste",
    email: "teste@exemplo.com",
    cpf_cnpj: "12345678909",
    rg: "12.345.678-9",
    person_type: "Física",
    phone_number: "11987654321",
    cell_phone_number_1: "11912345678",
    cell_phone_number_2: "11988887777",
    status: "Ativo",
    due_day: 15,
    zip_code: "01234-567",
    street: "Rua das Flores",
    number: "123",
    complement: "Apto 45",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    server_id: 1,
    plan_id: 1,
    customer_group_id: 1,
    financial_status: "L",
    server: { id: 1, name: "Servidor Principal", hash_server: "abc123" },
    plan: { id: 1, name: "Plano 500 Mega", value: "129.90" },
    customer_group: { id: 1, name: "Residencial" },
  };
}

export function getTestBillings() {
  return [
    // ── 2023 (paid) ──
    {
      id: 2001,
      customer_id: 999,
      value: 99.90,
      value_paid: 99.90,
      date_payment: "2023-01-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Janeiro/2023",
      type_billing: "Mensalidade",
      due_day: "2023-01-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678902001",
      observation: null,
      our_number: "200001",
    },
    {
      id: 2002,
      customer_id: 999,
      value: 99.90,
      value_paid: 99.90,
      date_payment: "2023-07-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Julho/2023",
      type_billing: "Mensalidade",
      due_day: "2023-07-15",
      form_payment: "PIX",
      observation: null,
      our_number: "200002",
    },
    // ── 2024 (paid) ──
    {
      id: 2003,
      customer_id: 999,
      value: 109.90,
      value_paid: 109.90,
      date_payment: "2024-03-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Março/2024",
      type_billing: "Mensalidade",
      due_day: "2024-03-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678902003",
      observation: null,
      our_number: "200003",
    },
    {
      id: 2004,
      customer_id: 999,
      value: 109.90,
      value_paid: 109.90,
      date_payment: "2024-11-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Novembro/2024",
      type_billing: "Mensalidade",
      due_day: "2024-11-15",
      form_payment: "PIX",
      observation: null,
      our_number: "200004",
    },
    // ── 2025 (overdue — never paid) ──
    {
      id: 2005,
      customer_id: 999,
      value: 119.90,
      value_paid: null,
      date_payment: null,
      situation_id: 2,
      situation_name: "Vencido",
      reference: "Fevereiro/2025",
      type_billing: "Mensalidade",
      due_day: "2025-02-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678902005",
      pix_copy_paste_base64: "MDAwMjAxMDEwMjEyMjYxMDYwMTRici5nb3YuYmNiLnBpeDI1NThhcGkucGl4LmNvbS92Mi9jb2J2LzEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5NTIwNDAwMDAwNTMwMzk4NjU0MDYxMjkuOTA1ODAyQlI1OTEzQ2xpZW50ZSBUZXN0ZTYwMDlTYW8gUGF1bG82MjA3MDUwMyoqKjYzMDQxMjM1",
      observation: null,
      our_number: "200005",
    },
    {
      id: 2006,
      customer_id: 999,
      value: 119.90,
      value_paid: null,
      date_payment: null,
      situation_id: 2,
      situation_name: "Vencido",
      reference: "Outubro/2025",
      type_billing: "Mensalidade",
      due_day: "2025-10-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678902006",
      pix_copy_paste_base64: "MDAwMjAxMDEwMjEyMjYxMDYwMTRici5nb3YuYmNiLnBpeDI1NThhcGkucGl4LmNvbS92Mi9jb2J2LzEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5NTIwNDAwMDAwNTMwMzk4NjU0MDYxMjkuOTA1ODAyQlI1OTEzQ2xpZW50ZSBUZXN0ZTYwMDlTYW8gUGF1bG82MjA3MDUwMyoqKjYzMDQxMjM2",
      observation: null,
      our_number: "200006",
    },
    // ── 2026 (mixed: 3 unpaid, 2 paid) ──
    {
      id: 1001,
      customer_id: 999,
      value: 129.90,
      value_paid: null,
      date_payment: null,
      situation_id: 2,
      situation_name: "Vencido",
      reference: "Junho/2026",
      type_billing: "Mensalidade",
      due_day: "2026-06-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901234",
      pix_copy_paste_base64: "MDAwMjAxMDEwMjEyMjYxMDYwMTRici5nb3YuYmNiLnBpeDI1NThhcGkucGl4LmNvbS92Mi9jb2J2LzEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5NTIwNDAwMDAwNTMwMzk4NjU0MDYxMjkuOTA1ODAyQlI1OTEzQ2xpZW50ZSBUZXN0ZTYwMDlTYW8gUGF1bG82MjA3MDUwMyoqKjYzMDQxMjM0",
      observation: null,
      our_number: "123456",
    },
    {
      id: 1002,
      customer_id: 999,
      value: 129.90,
      value_paid: null,
      date_payment: null,
      situation_id: 1,
      situation_name: "Em Aberto",
      reference: "Julho/2026",
      type_billing: "Mensalidade",
      due_day: "2026-07-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901235",
      pix_copy_paste_base64: "MDAwMjAxMDEwMjEyMjYxMDYwMTRici5nb3YuYmNiLnBpeDI1NThhcGkucGl4LmNvbS92Mi9jb2J2LzEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5NTIwNDAwMDAwNTMwMzk4NjU0MDYxMjkuOTA1ODAyQlI1OTEzQ2xpZW50ZSBUZXN0ZTYwMDlTYW8gUGF1bG82MjA3MDUwMyoqKjYzMDQxMjM1",
      observation: null,
      our_number: "123457",
      integration_link: "https://boleto.exemplo.com/pdf/1002",
    },
    {
      id: 1003,
      customer_id: 999,
      value: 129.90,
      value_paid: null,
      date_payment: null,
      situation_id: 1,
      situation_name: "Em Aberto",
      reference: "Agosto/2026",
      type_billing: "Mensalidade",
      due_day: "2026-08-15",
      form_payment: "Boleto",
      digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901236",
      pix_copy_paste_base64: "MDAwMjAxMDEwMjEyMjYxMDYwMTRici5nb3YuYmNiLnBpeDI1NThhcGkucGl4LmNvbS92Mi9jb2J2LzEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5NTIwNDAwMDAwNTMwMzk4NjU0MDYxMjkuOTA1ODAyQlI1OTEzQ2xpZW50ZSBUZXN0ZTYwMDlTYW8gUGF1bG82MjA3MDUwMyoqKjYzMDQxMjM2",
      observation: null,
      our_number: "123458",
      integration_link: "https://boleto.exemplo.com/pdf/1003",
    },
    {
      id: 1004,
      customer_id: 999,
      value: 129.90,
      value_paid: 129.90,
      date_payment: "2026-04-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Abril/2026",
      type_billing: "Mensalidade",
      due_day: "2026-04-15",
      form_payment: "PIX",
      observation: null,
      our_number: "123454",
    },
    {
      id: 1005,
      customer_id: 999,
      value: 129.90,
      value_paid: 129.90,
      date_payment: "2026-05-10",
      situation_id: 3,
      situation_name: "Pago",
      reference: "Maio/2026",
      type_billing: "Mensalidade",
      due_day: "2026-05-15",
      form_payment: "PIX",
      observation: null,
      our_number: "123455",
    },
  ];
}

export function getTestLoginResponse() {
  return {
    success: true,
    customer: { id: "test-12345678909", name: "Usuário Teste", email: "teste@exemplo.com" },
    hasMultipleContacts: false,
    contacts: [],
    sessionToken: "test-session-token",
    expiresAt: Date.now() + 86400000,
  };
}

export function storeTestSession() {
  const session: TestSession = {
    cpf: "12345678909",
    customerId: "test-12345678909",
    customerName: "Usuário Teste",
    email: "teste@exemplo.com",
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function clearTestSession() {
  try {
    localStorage.removeItem(TEST_SESSION_KEY);
  } catch {}
}

export function getStoredTestSession(): TestSession | null {
  try {
    const stored = localStorage.getItem(TEST_SESSION_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored) as TestSession;
    // Session expires after 24 hours
    if (Date.now() - session.createdAt > 86400000) {
      localStorage.removeItem(TEST_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
