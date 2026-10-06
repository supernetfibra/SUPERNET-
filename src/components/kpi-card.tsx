/**
 * KpiCard — card de métrica oficial (Design System, ETAPA 2).
 *
 * Referência visual: os cards de estatística de AdminInstallRequests (idênticos
 * aos do Dashboard do cliente) — círculo de ícone + valor + label em caixa alta.
 * Era o padrão mais completo dos 5 encontrados na auditoria; adotá-lo elimina as
 * demais variações tipográficas (font-light/semibold/bold, text-lg/xl/2xl).
 *
 * Cores do círculo por tom: mesmas já usadas nos cards existentes
 * (bg-{c}-100 dark:bg-{c}-900/30). "secondary" = círculo neutro bg-secondary.
 */

import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/status-badge";

export type KpiTone = StatusTone | "secondary";

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Cor do círculo do ícone. Default "secondary". */
  tone?: KpiTone;
  /** Texto pequeno abaixo do label (ex.: "3 aprovadas"). */
  description?: ReactNode;
  /** Mostra skeleton no lugar do valor. */
  loading?: boolean;
  className?: string;
}

const ICON_TONE: Record<KpiTone, { circle: string; icon: string }> = {
  success: {
    circle: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    circle: "bg-amber-100 dark:bg-amber-900/30",
    icon: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    circle: "bg-red-100 dark:bg-red-900/30",
    icon: "text-red-600 dark:text-red-400",
  },
  info: {
    circle: "bg-blue-100 dark:bg-blue-900/30",
    icon: "text-blue-600 dark:text-blue-400",
  },
  neutral: { circle: "bg-secondary", icon: "text-foreground" },
  secondary: { circle: "bg-secondary", icon: "text-foreground" },
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "secondary",
  description,
  loading = false,
  className,
}: KpiCardProps) {
  const t = ICON_TONE[tone];

  return (
    <Card className={cn("border-border shadow-none", className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {Icon ? (
            <div
              className={cn(
                "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                t.circle,
              )}
            >
              <Icon className={cn("h-4 w-4", t.icon)} />
            </div>
          ) : null}
          <div className="min-w-0">
            {loading ? (
              <div className="h-6 w-12 bg-secondary/50 rounded-sm animate-pulse" />
            ) : (
              <p className="text-lg font-semibold text-foreground">{value}</p>
            )}
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            {description ? (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
