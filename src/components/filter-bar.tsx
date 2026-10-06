/**
 * FilterBar — padrão oficial de barra de filtros (Design System, Fase 3).
 *
 * Estrutura única (AdminMessages/AdminInstallRequests/Simulador): coluna no
 * mobile, linha alinhada no desktop. O objetivo é padronizar estrutura,
 * espaçamento e comportamento — NÃO uniformizar interação: Selects, Tabs e
 * chips continuam sendo passados como children de cada tela.
 *
 * - FilterSearch: input de busca com ícone (padrão Faturas/InstallRequests),
 *   botão de limpar opcional.
 * - FilterResults: linha de contagem + "Limpar filtros" (padrão
 *   InstallRequests) — só aparece quando um dos dois existe.
 */

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-center", className)}>
      {children}
    </div>
  );
}

export interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mostra o botão "x" de limpar quando há valor. */
  onClear?: () => void;
  /** aria-label do input (obrigatório quando não há label visível). */
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
}

export function FilterSearch({
  value,
  onChange,
  placeholder,
  onClear,
  ariaLabel,
  className,
  inputClassName,
}: FilterSearchProps) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-9 pr-9 pl-9 text-sm", inputClassName)}
      />
      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpar busca"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterResultsProps {
  /** Quantidade de resultados do filtro atual. */
  count: number;
  /** Rótulo do item ("solicitação", "mensagem"...). Pluralizado com "s". */
  unit?: string;
  /** Limpa todos os filtros — botão só existe quando informado. */
  onClear?: () => void;
  className?: string;
}

export function FilterResults({
  count,
  unit = "resultado",
  onClear,
  className,
}: FilterResultsProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>
        {count} {unit}
        {count !== 1 ? "s" : ""}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer text-foreground transition-colors hover:underline"
        >
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
