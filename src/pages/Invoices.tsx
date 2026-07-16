/**
 * Invoices Page — Full list of customer invoices with filtering,
 * status indicators, and quick actions (download PDF, copy PIX/linha).
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  FileText,
  Download,
  Copy,
  CopyCheck,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useBillings, formatVencimentoComMes } from "@/hooks/use-billings";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusConfig } from "@/lib/status-config";
import type { BillingSummary } from "@/hooks/use-billings";

type FilterStatus = "all" | "pendente" | "pago" | "vencido";

const ITEMS_PER_PAGE = 10;

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading } = useBillings();
  const [copiedId, handleCopy] = useCopyToClipboard();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [page, setPage] = useState(1);

  const filteredBillings = useMemo(() => {
    return filter === "all"
      ? billings
      : billings.filter((b: BillingSummary) => b.status === filter);
  }, [billings, filter]);

  const totalPages = Math.ceil(filteredBillings.length / ITEMS_PER_PAGE);
  const paginatedBillings = filteredBillings.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [filter]);

  // Clamp page if it exceeds total pages (e.g., after filter change)
  useEffect(() => {
    if (page > totalPages && totalPages > 0) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Generate visible page numbers for the paginator
  const pageNumbers = useMemo(() => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("ellipsis");
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  const startItem = filteredBillings.length > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const endItem = Math.min(page * ITEMS_PER_PAGE, filteredBillings.length);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">Faturas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico completo de suas cobranças.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-sm border border-border overflow-hidden">
          {(["all", "pendente", "pago"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-xs transition-colors ${
                filter === f
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {f === "all" ? "Todas" : f === "pendente" ? "Pendentes" : "Pagas"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground ml-auto">
          {filteredBillings.length} fatura{filteredBillings.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Billing List */}
      {isLoading ? (
        <div className="text-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Carregando faturas...</p>
        </div>
      ) : filteredBillings.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma fatura encontrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginatedBillings.map((billing, index) => {
            const status = statusConfig[billing.status] || statusConfig.pendente;
            const StatusIcon = status.icon;

            return (
              <div
                key={billing.id}
                className="animate-[slideUp_0.2s_ease-out]"
                style={{ animationDelay: `${0.03 * index}s` }}
              >
                <Card
                  className={`border shadow-none transition-colors cursor-pointer ${
                    billing.status === "vencido"
                      ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40"
                      : "border-border hover:bg-secondary/30"
                  }`}
                  onClick={() => navigate(`/faturas/${billing.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {formatVencimentoComMes(billing.vencimento)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {billing.competencia}
                            {billing.status === "pago" && billing.data_pagamento && (
                              <> · Pago em: {billing.data_pagamento}</>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">
                            {billing.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </p>
                          {billing.status === "pago" && billing.valor_pago && (
                            <p className="text-[10px] text-muted-foreground">
                              Pago
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color}`}
                        >
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {status.label}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>

                    {/* Quick actions for pending */}
                    {billing.status === "pendente" && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
                        {billing.linha_digitavel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(billing.linha_digitavel!, `line-${billing.id}`);
                            }}
                          >
                            {copiedId === `line-${billing.id}` ? (
                              <CopyCheck className="h-3 w-3 mr-1" />
                            ) : (
                              <Copy className="h-3 w-3 mr-1" />
                            )}
                            Linha digitável
                          </Button>
                        )}
                        {billing.pix_copiaecola && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(billing.pix_copiaecola!, `pix-${billing.id}`);
                            }}
                          >
                            {copiedId === `pix-${billing.id}` ? (
                              <CopyCheck className="h-3 w-3 mr-1" />
                            ) : (
                              <Copy className="h-3 w-3 mr-1" />
                            )}
                            PIX
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/api/mikweb/billings/${billing.id}/download`, "_blank");
                          }}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          PDF
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && filteredBillings.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground order-2 sm:order-1">
            {startItem}–{endItem} de {filteredBillings.length}
          </p>
          <Pagination className="order-1 sm:order-2">
            <PaginationContent>
              <PaginationItem>
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 w-8 disabled:opacity-30 hover:bg-secondary/50 transition-colors"
                  aria-label="Primeira página"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              </PaginationItem>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (page > 1) setPage(page - 1);
                  }}
                  className={page === 1 ? "pointer-events-none opacity-30" : ""}
                />
              </PaginationItem>
              {pageNumbers.map((p, i) =>
                p === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => {
                        e.preventDefault();
                        setPage(p);
                      }}
                      className="h-8 w-8 text-xs"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (page < totalPages) setPage(page + 1);
                  }}
                  className={page === totalPages ? "pointer-events-none opacity-30" : ""}
                />
              </PaginationItem>
              <PaginationItem>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 w-8 disabled:opacity-30 hover:bg-secondary/50 transition-colors"
                  aria-label="Última página"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
