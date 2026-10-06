/**
 * EmptyState — estado vazio oficial (Design System, Fase 3).
 *
 * Construído sobre o primitivo `ui/empty` (instalado e antes com zero usos).
 * Referências visuais: os empty states ad-hoc das telas admin (ícone + título +
 * descrição centrados) — os textos das telas são preservados; o ícone ganha o
 * tratamento oficial do primitivo (círculo bg-muted, tamanho fixo).
 *
 * Suporta ação primária e secundária (slots passivos — quem decide o botão é a
 * tela, mantendo o componente previsível).
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Ícone principal (padrão: círculo bg-muted com ícone h-6). */
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Ação primária (ex.: <Button>Atualizar</Button>). */
  action?: ReactNode;
  /** Ação secundária, exibida ao lado da primária. */
  secondaryAction?: ReactNode;
  /**
   * "section" (padrão): dentro de cards/listas (py-8).
   * "page": estado vazio de página inteira (py-12 md:p-12).
   */
  size?: "section" | "page";
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = "section",
  className,
}: EmptyStateProps) {
  return (
    <Empty
      className={cn(
        size === "page" ? "py-12 md:p-12" : "py-8",
        "gap-4",
        className,
      )}
    >
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="text-sm font-medium">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="text-xs">{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action || secondaryAction ? (
        <EmptyContent className="flex-row items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
