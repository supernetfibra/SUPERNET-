/**
 * ErrorState — padrão oficial de erro (Design System, Fase 3).
 *
 * Referências visuais: card de erro py-12 do AdminReferrals e os estados de
 * erro dispersos (Perfil, banners). NÃO é reload global: `onRetry` é um
 * callback por seção/página que a tela liga ao seu próprio loader.
 *
 * Diferenciação pedida pela auditoria (carregamento / auth / rede / ação /
 * não encontrado) é feita pelos props title/description — o componente não
 * conhece a origem do erro e não altera o fluxo de autenticação:
 *   - carregamento em andamento → usar spinner/skeleton (não ErrorState);
 *   - 401 de admin              → AdminLayout redireciona (mantido);
 *   - rede / 5xx / ação falha   → ErrorState com onRetry por seção;
 *   - registro não encontrado   → EmptyState (não é erro).
 */

import { AlertCircle, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  /** Mensagem/detalhe do erro (ex.: o texto vindo do loadError da tela). */
  description?: ReactNode;
  /** Callback de retry da própria seção (spinner aparece quando retrying). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Mostra spinner no botão de retry (durante o recarregamento). */
  retrying?: boolean;
  /** Ação alternativa (ex.: voltar, abrir documentação). */
  action?: ReactNode;
  /** Ícone do estado. Padrão AlertCircle. */
  icon?: LucideIcon;
  /** "section" (padrão, dentro de card) | "page" (página inteira). */
  size?: "section" | "page";
  className?: string;
}

export function ErrorState({
  title = "Erro ao carregar",
  description,
  onRetry,
  retryLabel = "Tentar novamente",
  retrying = false,
  action,
  icon: Icon = AlertCircle,
  size = "section",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        size === "page" ? "py-16" : "py-12",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {onRetry || action ? (
        <div className="flex items-center gap-2">
          {onRetry ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
