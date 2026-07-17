/**
 * Test User Module — fornece dados mockados para testes em preview/desenvolvimento
 * sem precisar da API MikWeb real ou deploy no Convex.
 *
 * CPF de teste: 12345678900
 * Senha: 8900 (4 últimos dígitos do CPF)
 */

const TEST_CPFS = ["12345678900"];
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
  const last4Cpf = normalizedCpf.slice(-4);
  return last4Cpf === normalizedPassword;
}

export function getTestCustomerData() {
  return {
    id: 999,
    full_name: "Usuário Teste",
    login: "teste",
    email: "teste@exemplo.com",
    cpf_cnpj: "12345678900",
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
      value_paid: 129.90,
      date_payment: "2026-06-10",
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
    customer: { id: "test-12345678900", name: "Usuário Teste", email: "teste@exemplo.com" },
    hasMultipleContacts: true,
    contacts: [
      { id: "999-phone", label: "Telefone", phoneMasked: "(11) 9876****21" },
      { id: "999-cell1", label: "Celular 1", phoneMasked: "(11) 9123****78" },
    ],
    sessionToken: "test-session-token",
    expiresAt: Date.now() + 86400000,
  };
}

export function storeTestSession() {
  const session: TestSession = {
    cpf: "12345678900",
    customerId: "test-12345678900",
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
