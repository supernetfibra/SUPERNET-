/**
 * StatusBadge — badge semântico de status (Design System, ETAPA 2).
 *
 * Referência visual: `src/lib/status-config.ts` (faturas) + os badges já
 * existentes no admin (`statusBadgeClass`, `typeLabels`, `installStatusInfo`,
 * badges de indicação). Nada foi redesenhado — as classes abaixo reproduzem os
 * estilos atuais através dos tokens semânticos definidos em `src/index.css`
 * (success/warning/danger/info/neutral), que flipam no dark automaticamente.
 *
 * Dois estilos já presentes no produto:
 *   - "solid" (padrão): fundo {c}-50 claro / {c}-950-20 escuro — usado por
 *     status-config, statusBadgeClass e installStatusInfo.
 *   - "soft": fundo {c}-500/15 com borda {c}-500/30 — usado pelos badges de
 *     indicação (Referrals/AdminReferrals) e de entrega (AdminMessages).
 *
 * Objetivo: eliminar gradualmente os 4 sistemas paralelos de badge; novas telas
 * NÃO devem montar classes de cor manualmente — use tone + label + icon.
 */

import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Estilo "solid" — fundo claro, sem borda (status-config / installStatusInfo). */
const TONE_SOLID: Record<StatusTone, string> = {
  success: "bg-status-success-bg text-status-success",
  warning: "bg-status-warning-bg text-status-warning",
  danger: "bg-status-danger-bg text-status-danger",
  info: "bg-status-info-bg text-status-info",
  neutral: "bg-status-neutral-bg text-status-neutral",
};

/** Estilo "soft" — fundo translúcido {c}-500/15 com borda {c}-500/30 (Referrals). */
const TONE_SOFT: Record<StatusTone, string> = {
  success: "bg-status-success-soft text-status-success border-status-success/30",
  warning: "bg-status-warning-soft text-status-warning border-status-warning/30",
  danger: "bg-status-danger-soft text-status-danger border-status-danger/30",
  info: "bg-status-info-soft text-status-info border-status-info/30",
  neutral: "bg-status-neutral-soft text-status-neutral border-status-neutral/30",
};

/** Borda sólida (statusBadgeClass da consulta MikWeb usava borda {c}-200/900). */
const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-status-success-border",
  warning: "border-status-warning-border",
  danger: "border-status-danger-border",
  info: "border-status-info-border",
  neutral: "border-status-neutral-border",
};

export interface StatusBadgeProps {
  /** Tom semântico. Default "neutral". */
  tone?: StatusTone;
  label: ReactNode;
  /** Ícone opcional à esquerda (padrão: h-3 w-3, igual aos badges existentes). */
  icon?: LucideIcon;
  /** "solid" (padrão) ou "soft". */
  variant?: "solid" | "soft";
  /** Exibe a borda no estilo solid (padrão statusBadgeClass). */
  bordered?: boolean;
  className?: string;
}

export function StatusBadge({
  tone = "neutral",
  label,
  icon: Icon,
  variant = "solid",
  bordered = false,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        variant === "soft"
          ? TONE_SOFT[tone]
          : cn(TONE_SOLID[tone], bordered ? TONE_BORDER[tone] : "border-none"),
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </Badge>
  );
}
