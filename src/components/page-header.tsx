/**
 * PageHeader — cabeçalho de página oficial (Design System, ETAPA 2).
 *
 * Referência visual: o header dominante do produto (título `text-xl font-medium
 * tracking-tight` + subtítulo `text-sm text-muted-foreground mt-1`), com slots
 * para os 4 padrões encontrados na auditoria:
 *   - simples (cliente e maioria do admin): title + description
 *   - com ações à direita: actions (AdminDashboard, AdminMessages)
 *   - com badge no título: badge (AdminInstallRequests, AdminMessages)
 *   - com botão voltar: onBack (AdminReferrals)
 *
 * Usa os tokens tipográficos text-page-title/text-body (visual idêntico ao
 * padrão atual) e valida a escala da ETAPA 1.
 */

import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Ícone opcional antes do título (padrão atual: h-5 w-5 text-muted-foreground). */
  icon?: LucideIcon;
  /** Badge opcional exibido ao lado do título (contadores, "Ao vivo" etc.). */
  badge?: ReactNode;
  /** Ações principais, alinhadas à direita no desktop e abaixo no mobile. */
  actions?: ReactNode;
  /** Mostra botão voltar (seta) à esquerda do título. */
  onBack?: () => void;
  /** aria-label do botão voltar. */
  backLabel?: string;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  badge,
  actions,
  onBack,
  backLabel = "Voltar",
  className,
}: PageHeaderProps) {
  return (
    /* FASE 6 / item 7 — antes o mobile era `flex-col`: as ações caíam
       SEMPRE numa segunda linha, e quando havia só um botão-ícone (o
       recarregar do Cliente 360) ele ficava sozinho, com uma linha inteira
       só para ele. Agora título e ações dividem a linha em todas as larguras:
       o título ocupa o espaço restante (quebra o texto se precisar) e as ações
       ficam à direita, encostadas no topo.

       `flex-wrap` vale para TODAS as larguras (não só <sm): em 834px um
       `sm:flex-nowrap` empurrava as ações 347px para fora da viewport.
       No desktop largo (1440) título + ações cabem de qualquer jeito, então
       a linha não quebra e o resultado é idêntico ao anterior. */
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 sm:items-center",
        className,
      )}
    >
      {/* min-w + basis-64: o título NUNCA encolhe abaixo de 16rem. Sem o
          min-w, o flex-shrink o espremia para ~50px quando a linha tinha
          muitas ações (medido em 834px em Mensagens: título quebrando uma
          palavra por linha). Com o piso, a linha estoura e as AÇÕES descem
          para baixo — que é o fallback correto. */}
      <div className="flex-1 basis-64 min-w-[16rem]">
        <div className="flex items-center gap-2 flex-wrap">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={backLabel}
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          {Icon ? (
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : null}
          <h1 className="text-page-title text-foreground">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="text-body text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      {actions ? (
        /* SEM shrink-0: em telas médias (834px) as ações podem ser mais largas
           que a linha inteira — com shrink-0 elas sangravam 347px fora da
           viewport (medido). Podendo encolher, o flex-wrap interno quebra os
           botões em duas fileiras dentro do próprio bloco de ações. */
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">{actions}</div>
      ) : null}
    </div>
  );
}
