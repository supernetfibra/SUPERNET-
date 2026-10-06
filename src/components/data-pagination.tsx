/**
 * DataPagination — paginação client-side oficial (Design System, Fase 3).
 *
 * Construída sobre o primitivo `ui/pagination` (instalado, zero usos antes).
 * Usa Button em vez de PaginationLink (`<a>`) porque a navegação aqui é por
 * estado, não por URL — a estrutura/semântica (nav, aria-label, ul/li) vem do
 * primitivo.
 *
 * API: página atual (1-based), total de páginas, anterior/próxima, janela de
 * números com reticências e total de registros quando disponível.
 *
 * Escopo: client-side apenas. Nenhum endpoint foi alterado nesta fase — listas
 * que precisarem de paginação server-side devem documentar a mudança de
 * contrato para uma fase futura.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

export interface DataPaginationProps {
  /** Página atual, 1-based. */
  page: number;
  /** Total de páginas (≥ 1). */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total de registros, quando conhecido (exibido no rótulo). */
  total?: number;
  /** Substantivo do rótulo (default "registros"). */
  unit?: string;
  className?: string;
}

/** Janela compacta de números: 1 … p-1 p p+1 … N. */
function pageWindow(page: number, pageCount: number): (number | "ellipsis-left" | "ellipsis-right")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const items: (number | "ellipsis-left" | "ellipsis-right")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("ellipsis-left");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pageCount - 1) items.push("ellipsis-right");
  items.push(pageCount);
  return items;
}

export function DataPagination({
  page,
  pageCount,
  onPageChange,
  total,
  unit = "registros",
  className,
}: DataPaginationProps) {
  if (pageCount <= 1) return null;

  const safePage = Math.min(Math.max(1, page), pageCount);
  const canPrev = safePage > 1;
  const canNext = safePage < pageCount;

  return (
    <Pagination
      className={cn(
        "flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground",
        className,
      )}
    >
      {typeof total === "number" ? (
        <span className="text-xs">
          Página {safePage} de {pageCount} · {total} {unit}
        </span>
      ) : (
        <span className="text-xs">
          Página {safePage} de {pageCount}
        </span>
      )}
      <PaginationContent>
        <PaginationItem>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            aria-label="Página anterior"
            disabled={!canPrev}
            onClick={() => onPageChange(safePage - 1)}
          >
            <ChevronLeft className="h-3 w-3" />
            Anterior
          </Button>
        </PaginationItem>
        {pageWindow(safePage, pageCount).map((item, i) =>
          typeof item === "number" ? (
            <PaginationItem key={i}>
              <Button
                variant={item === safePage ? "secondary" : "ghost"}
                size="sm"
                className="h-7 min-w-7 px-2 text-xs tabular-nums"
                aria-label={`Ir para página ${item}`}
                aria-current={item === safePage ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            </PaginationItem>
          ) : (
            <PaginationItem key={i}>
              <PaginationEllipsis className="size-7" />
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            aria-label="Próxima página"
            disabled={!canNext}
            onClick={() => onPageChange(safePage + 1)}
          >
            Próxima
            <ChevronRight className="h-3 w-3" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
