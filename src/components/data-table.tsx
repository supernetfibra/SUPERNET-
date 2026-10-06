/**
 * DataTable — listagem administrativa oficial (Design System, Fase 3).
 *
 * Construída sobre `ui/table` (padrão provado no AdminSimulator, que continua
 * intocado como referência). Não é um framework de tabelas: cobre os padrões
 * reais do projeto — colunas com render custom, alinhamento, colunas escondidas
 * por breakpoint (`hideBelow`, padrão do Simulador), header sticky, ações por
 * linha, seleção com select-all, ordenação opcional (`sortValue`) e paginação
 * client-side opt-in (`pageSize`).
 *
 * Responsividade por lista (decisão por tela, não solução única):
 *   - scroll horizontal é o comportamento default (igual hoje);
 *   - `hideBelow` esconde colunas secundárias quando a tela optar;
 *   - estratégias "cards" e "detalhe em Sheet" ficam para cada tela decidir
 *     na Fase 4, caso o scroll não baste.
 *
 * Paginação: client-side apenas, ativa só quando `pageSize` é informado e há
 * mais de uma página. Nenhum endpoint foi alterado nesta fase.
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { DataPagination } from "@/components/data-pagination";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  /** Chave única da coluna; usado como fallback de render (row[key]). */
  key: string;
  header: ReactNode;
  align?: "left" | "center" | "right";
  /** Classes extras na célula (larguras, truncamento, tipografia). */
  className?: string;
  headerClassName?: string;
  /** Esconde a coluna abaixo do breakpoint (hidden sm:table-cell etc.). */
  hideBelow?: "sm" | "md" | "lg";
  /** Render customizado da célula. Default: valor bruto de row[key]. */
  render?: (row: T) => ReactNode;
  /** Habilita ordenação para a coluna quando informado. */
  sortValue?: (row: T) => string | number;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** Identificador estável da linha (necessário para seleção/paginação). */
  getRowId: (row: T, index: number) => string;
  /** Skeleton de N linhas enquanto carrega. */
  loading?: boolean;
  loadingRows?: number;
  /** Estado vazio — normalmente <EmptyState/>. Renderizado com colSpan total. */
  empty?: ReactNode;
  /** Torna a linha clicável (hover + cursor). */
  onRowClick?: (row: T) => void;
  /** Coluna "Ações" à direita. */
  rowActions?: (row: T) => ReactNode;
  rowActionsHeader?: ReactNode;
  /** Seleção controlada pela tela (Set de ids). */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleRow?: (id: string) => void;
  /** Select-all do header. O escopo (página/lista inteira) é decisão da tela. */
  onSelectAll?: (checked: boolean) => void;
  /** Paginação client-side: ativa somente quando definido. */
  pageSize?: number;
  /** Densidade: "md" (padrão, igual ao Simulador) ou "sm" (listas densas tipo outbox). */
  size?: "sm" | "md";
  /** Classes extras na <table> (ex.: tipografia base da lista). */
  tableClassName?: string;
  /** Header fixo ao rolar (use junto de containerClassName com max-h). */
  stickyHeader?: boolean;
  /** Classes do wrapper de overflow (ex.: max-h-[500px] overflow-y-auto). */
  containerClassName?: string;
  className?: string;
}

const ALIGN: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const HIDE_BELOW: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading = false,
  loadingRows = 5,
  empty,
  onRowClick,
  rowActions,
  rowActionsHeader = "Ações",
  selectable = false,
  selectedIds,
  onToggleRow,
  onSelectAll,
  pageSize,
  size = "md",
  tableClassName,
  stickyHeader = false,
  containerClassName,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return data;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  }, [data, sort, columns]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  // Clamp em render: filtro/lista encolheu e a página atual ficou fora do range.
  const safePage = Math.min(page, pageCount - 1);
  const pagedData = useMemo(() => {
    if (!pageSize || pageCount <= 1) return sortedData;
    return sortedData.slice(safePage * pageSize, (safePage + 1) * pageSize);
  }, [sortedData, pageSize, pageCount, safePage]);

  const hasActions = Boolean(rowActions);
  const colCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const pageIds = pagedData.map((row, i) => getRowId(row, i));
  const selectedOnPage = selectable
    ? pageIds.filter((id) => selectedIds?.has(id)).length
    : 0;
  const allSelected = selectable && pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someSelected = selectable && selectedOnPage > 0 && !allSelected;

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
    setPage(0);
  };

  const cellAlignClass = (align?: "left" | "center" | "right") =>
    ALIGN[align ?? "left"];

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "overflow-x-auto rounded-sm border border-border",
          containerClassName,
        )}
      >
        <Table className={tableClassName}>
          <TableHeader
            className={cn(stickyHeader && "sticky top-0 z-10 bg-background")}
          >
            <TableRow className="hover:bg-transparent">
              {selectable ? (
                <TableHead className="w-10 text-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => onSelectAll?.(checked === true)}
                    aria-label="Selecionar tudo"
                    className="cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableHead>
              ) : null}
              {columns.map((col) => {
                const sortable = Boolean(col.sortValue);
                const active = sort?.key === col.key;
                return (
                  <TableHead
                    key={col.key}
                    aria-sort={
                      sortable && active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn(
                      "text-xs h-8",
                      cellAlignClass(col.align),
                      col.hideBelow ? HIDE_BELOW[col.hideBelow] : null,
                      col.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 font-medium hover:text-foreground",
                          cellAlignClass(col.align),
                        )}
                      >
                        {col.header}
                        {active && sort!.dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : active && sort!.dir === "desc" ? (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
              {hasActions ? (
                <TableHead className="text-right text-xs h-8">
                  {rowActionsHeader}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody className={size === "sm" ? "[&_td]:py-3 [&_td]:px-4 [&_th]:py-2.5 [&_th]:px-4" : undefined}>
            {loading ? (
              Array.from({ length: loadingRows }, (_, i) => (
                <TableRow key={`loading-${i}`}>
                  {selectable ? (
                    <TableCell className="text-center">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                  ) : null}
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        col.hideBelow ? HIDE_BELOW[col.hideBelow] : null,
                        col.className,
                      )}
                    >
                      <Skeleton className="h-4 w-full max-w-[120px]" />
                    </TableCell>
                  ))}
                  {hasActions ? (
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-4 w-14" />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : pagedData.length === 0 ? (
              empty != null ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="p-0">
                    {empty}
                  </TableCell>
                </TableRow>
              ) : null
            ) : (
              pagedData.map((row, index) => {
                const rowId = getRowId(row, index);
                const isSelected = selectable ? Boolean(selectedIds?.has(rowId)) : false;
                return (
                  <TableRow
                    key={rowId}
                    data-state={isSelected ? "selected" : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <TableCell
                        className="text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleRow?.(rowId);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleRow?.(rowId)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Selecionar linha ${index + 1}`}
                          className="cursor-pointer"
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((col) => (
                      <Fragment key={col.key}>
                        <TableCell
                          className={cn(
                            cellAlignClass(col.align),
                            col.hideBelow ? HIDE_BELOW[col.hideBelow] : null,
                            col.className,
                          )}
                        >
                          {col.render
                            ? col.render(row)
                            : String((row as Record<string, unknown>)[col.key] ?? "")}
                        </TableCell>
                      </Fragment>
                    ))}
                    {hasActions ? (
                      <TableCell
                        className="text-right"
                        onClick={(e) => onRowClick && e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {rowActions!(row)}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pageSize && !loading ? (
        <DataPagination
          page={safePage + 1}
          pageCount={pageCount}
          total={data.length}
          onPageChange={(p) => setPage(p - 1)}
        />
      ) : null}
    </div>
  );
}
