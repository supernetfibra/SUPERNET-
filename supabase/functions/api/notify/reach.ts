/**
 * Alcance por canal: quais clientes podem receber, por qual canal e com qual número.
 * Módulo puro (ver `model.ts`).
 *
 * Existe separado do simulador porque quem ENFILEIRA (o sync, `sync.ts`) e quem
 * SIMULA (`simulate.ts`) precisam responder a mesma pergunta: "para este cliente, o
 * WhatsApp existe? com que número?". Duas interpretações de `opt_in`, do telefone do
 * cadastro e do telefone salvo em `whatsapp_contacts` produziriam exatamente o tipo de
 * divergência entre relatório e envio que estas etapas foram feitas para eliminar.
 *
 * O tipo `SimulationContact` vive aqui pela mesma razão (e `simulate.ts` o reexporta,
 * para as fontes de dados continuarem importando de um lugar só).
 */

import { pickCustomerPhone, type RawCustomer } from "./model.ts";
import type { CustomerReach } from "./routing.ts";

export interface SimulationContact {
  customerId: string;
  phone?: string | null;
  optIn: boolean;
  /** Já trocou mensagem com o número — não consome cota de nova conversa. */
  hasConversation?: boolean;
}

export interface ReachInput {
  customers: RawCustomer[];
  contacts?: SimulationContact[];
  pushCustomerIds?: string[];
}

/**
 * Monta o mapa de alcance a partir do cadastro (MikWeb) + consentimento (outbox).
 *
 * O telefone salvo em `whatsapp_contacts` vence o do cadastro: é o número que a
 * pessoa de fato usa no WhatsApp (confirmado no opt-in), enquanto o cadastro pode
 * estar desatualizado. `push` não depende de opt-in por número — é inscrição de
 * navegador.
 */
export function resolveReach(input: ReachInput): Map<string, CustomerReach> {
  const push = new Set((input.pushCustomerIds ?? []).map(String));
  const contacts = new Map((input.contacts ?? []).map((c) => [String(c.customerId), c]));
  const reach = new Map<string, CustomerReach>();

  for (const customer of input.customers) {
    const id = String(customer.id);
    const contact = contacts.get(id);
    const phone = pickCustomerPhone(customer);
    const contactPhone = contact?.phone ? pickCustomerPhone({ id, cell_phone_number_1: contact.phone }) : null;

    const chosen = contactPhone?.ok ? contactPhone : phone;

    reach.set(id, {
      customerId: id,
      push: push.has(id),
      whatsappOptIn: Boolean(contact?.optIn),
      whatsappPhone: chosen.ok ? chosen.e164 : undefined,
      phoneField: chosen.ok ? chosen.field : undefined,
      phoneFailure: chosen.ok ? undefined : chosen.reason,
      hasExistingConversation: Boolean(contact?.hasConversation),
    });
  }

  return reach;
}
