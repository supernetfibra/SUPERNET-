/**
 * AdminReminderRules — página "Régua" do menu admin.
 *
 * Reúne, em um único lugar, TUDO que define quais lembretes saem e com que texto:
 * - ReminderRulesCard: quais degraus da régua estão ligados (3 dias antes, dia do
 *   vencimento, 1/5/10 dias de atraso) e horizon/runAtHour.
 * - ReminderMessagesCard: os textos (templates) de cada evento da régua.
 *
 * A página é de movimentação, não de código novo: os cards já em produção em
 * Configurações foram promovidos a página própria para dar ao operador um menu
 * direto "ver/configurar as regras da régua de lembretes".
 */

import { CalendarClock } from "lucide-react";
import { Link } from "react-router";
import { ReminderRulesCard } from "@/components/ReminderRulesCard";
import { ReminderMessagesCard } from "@/components/ReminderMessagesCard";
import { PageHeader } from "@/components/page-header";

export default function AdminReminderRules() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        icon={CalendarClock}
        title="Régua de lembretes"
        description={
          <>
            Define quais avisos saem por WhatsApp e com qual texto. Mudanças valem
            para as próximas sincronizações — mensagens já na fila não são alteradas.
          </>
        }
      />

      <ReminderRulesCard />

      <ReminderMessagesCard />

      {/* Atalhos para o resto do fluxo */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/simulator"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          Prévia: ver o que sairia com esta régua →
        </Link>
        <Link
          to="/admin/messages"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          Ver o que já foi enviado →
        </Link>
      </div>
    </div>
  );
}
