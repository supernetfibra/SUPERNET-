/**
 * Invoices Page — Full list of customer invoices with smart filtering,
 * intelligent status labels, and quick actions (download PDF, copy PIX/linha).
 * Overdue invoices are always highlighted first.
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
  AlertTriangle,
  Clock,
  Zap,
  CalendarDays,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useBillings, formatVencimentoComMes, getSmartLabel, extractMesInfo } from "@/hooks/use-billings";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusConfig } from "@/lib/status-config";
import type { BillingSummary } from "@/hooks/use-billings";

type FilterStatus = "abertas" | "vencidas" | "pagas";

const ITEMS_PER_PAGE = 10;

export default function Invoices() {
  const navigate = useNavigate();
  const { billings, isLoading } = useBillings();
  const [copiedId, handleCopy] = useCopyToClipboard();
  const [filter, setFilter] = useState<FilterStatus>("abertas");
  const [page, setPage] = useState(1);

  const filteredBillings = useMemo(() => {
    if (filter === "abertas") {
      // Abertas = pendente + vencido (tudo que não está pago nem cancelado)
      return billings.filter(
        (b: BillingSummary) => b.status === "pendente" || b.status === "vencido"
      );
    }
    if (filter === "vencidas") {
      return billings.filter((b: BillingSummary) => b.status === "vencido");
    }
    // pagas
    return billings.filter((b: BillingSummary) => b.status === "pago");
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

  // Clamp page if it exceeds total pages
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

  // Group paginated invoices by month for section headers
  const monthGroups = useMemo(() => {
    const groups: { mesNome: string; mesAno: string; invoices: BillingSummary[] }[] = [];
    const map = new Map<string, BillingSummary[]>();

    for (const b of paginatedBillings) {
      const info = extractMesInfo(b.vencimento);
      const key = info?.mesAno || "outros";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }

    // Sort groups chronologically descending (most recent first)
    const sortedKeys = [...map.keys()]
      .filter((k) => k !== "outros")
      .sort()
      .reverse();
    if (map.has("outros")) sortedKeys.push("outros");

    for (const key of sortedKeys) {
      const invoices = map.get(key)!;
      const firstInfo = extractMesInfo(invoices[0]?.vencimento || "");
      groups.push({
        mesNome: firstInfo?.mesNome || key,
        mesAno: key,
        invoices,
      });
    }

    return groups;
  }, [paginatedBillings]);

  const startItem = filteredBillings.length > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const endItem = Math.min(page * ITEMS_PER_PAGE, filteredBillings.length);

  const filterCounts = useMemo(() => {
    const abertas = billings.filter(
      (b: BillingSummary) => b.status === "pendente" || b.status === "vencido"
    ).length;
    const vencidas = billings.filter((b: BillingSummary) => b.status === "vencido").length;
    const pagas = billings.filter((b: BillingSummary) => b.status === "pago").length;
    return { abertas, vencidas, pagas };
  }, [billings]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">Faturas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acompanhe suas cobranças de forma inteligente.
        </p>
      </div>

      {/* Smart Filters */}
      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none">
        {([
          { key: "abertas" as const, label: "Abertas" },
          { key: "vencidas" as const, label: "Vencidas" },
          { key: "pagas" as const, label: "Pagas" },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`relative px-4 py-1.5 text-xs rounded-full border transition-all ${
              filter === f.key
                ? f.key === "vencidas"
                  ? "bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 font-medium"
                  : f.key === "abertas"
                  ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 font-medium"
                  : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {f.label}
            <span className="ml-1.5 opacity-60 text-[10px]">
              {filterCounts[f.key]}
            </span>
          </button>
        ))}
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
          <p className="text-sm text-muted-foreground">
            {filter === "abertas"
              ? "Nenhuma fatura aberta. 🎉"
              : filter === "vencidas"
              ? "Nenhuma fatura vencida. 🎉"
              : "Nenhuma fatura paga encontrada."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {monthGroups.map((group, gi) => (
            <div key={group.mesAno}>
              {/* Month header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-border/30" />
                <div className="flex items-center gap-2 shrink-0">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    {group.mesNome} {group.mesAno.split("-")[0]}
                  </span>
                </div>
                <div className="h-px flex-1 bg-border/30" />
              </div>

              {/* Invoices in this month */}
              <div className="space-y-2">
                {group.invoices.map((billing, index) => {
                  const status = statusConfig[billing.status] || statusConfig.pendente;
                  const StatusIcon = status.icon;
                  const smartLabel = getSmartLabel(billing);

                  // Card styling based on smart label type
                  const cardStyle =
                    smartLabel.type === "vencida"
                      ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40"
                      : smartLabel.type === "vence-hoje"
                      ? "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/40"
                      : smartLabel.type === "a-vencer"
                      ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-100/50 dark:hover:bg-amber-950/30"
                      : "border-border hover:bg-secondary/30";

                  // Smart label badge styling
                  const labelBadgeStyle =
                    smartLabel.type === "vencida"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : smartLabel.type === "vence-hoje"
                      ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                      : smartLabel.type === "a-vencer"
                      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                      : "bg-secondary text-muted-foreground";

                  const SmartIcon =
                    smartLabel.type === "vencida"
                      ? AlertTriangle
                      : smartLabel.type === "vence-hoje"
                      ? Zap
                      : smartLabel.type === "a-vencer"
                      ? Clock
                      : FileText;

                  return (
                    <div
                      key={billing.id}
                      className="animate-[slideUp_0.2s_ease-out]"
                      style={{ animationDelay: `${0.03 * index}s` }}
                    >
                      <Card
                        className={`border shadow-none transition-all cursor-pointer ${cardStyle}`}
                        onClick={() => navigate(`/faturas/${billing.id}`)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 min-w-0">
                              <div
                                className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                                  smartLabel.type === "vencida"
                                    ? "bg-red-100 dark:bg-red-900/30"
                                    : smartLabel.type === "vence-hoje"
                                    ? "bg-orange-100 dark:bg-orange-900/30"
                                    : smartLabel.type === "a-vencer"
                                    ? "bg-amber-100 dark:bg-amber-900/30"
                                    : "bg-secondary"
                                }`}
                              >
                                <SmartIcon
                                  className={`h-4 w-4 ${
                                    smartLabel.type === "vencida"
                                      ? "text-red-600 dark:text-red-400"
                                      : smartLabel.type === "vence-hoje"
                                      ? "text-orange-600 dark:text-orange-400"
                                      : smartLabel.type === "a-vencer"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground"
                                  }`}
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${labelBadgeStyle}`}
                                  >
                                    {smartLabel.text}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {billing.vencimento}
                                  {billing.competencia && (
                                    <> · Ref. {billing.competencia}</>
                                  )}
                                  {billing.status === "pago" && billing.data_pagamento && (
                                    <> · Pago em: {billing.data_pagamento}</>
                                  )}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                              <div className="text-right">
                                <p className="text-sm font-medium text-foreground whitespace-nowrap">
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
                                className={`text-[10px] font-medium px-2 py-0.5 border-none ${status.color} shrink-0`}
                              >
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {status.label}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
                            </div>
                          </div>

                          {/* Quick actions for pending */}
                          {(billing.status === "pendente" || billing.status === "vencido") && (
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
            </div>
          ))}
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
