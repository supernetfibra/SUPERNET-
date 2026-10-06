/**
 * NotFound Page — 404.
 * Uses CSS animations instead of framer-motion.
 *
 * FASE 6 / item 12 — antes havia só um link sublinhado no meio da tela, sem
 * ícone, sem explicação do que aconteceu e sem ação em destaque. Agora usa os
 * mesmos padrões das telas acima dele:
 *   - ícone em círculo bg-muted (como EmptyState/ErrorState);
 *   - texto explicando que a página não existe (e não que o app quebrou);
 *   - ação primária em Botão para voltar ao início;
 *   - `role="status"` + título `h1` para leitores de tela.
 *
 * A tela é renderizada FORA do AppLayout/AdminLayout (rota `*`), por isso não
 * pode usar PageHeader nem depender de contexto de navegação — daí o `<Link>`.
 */

import { Link } from "react-router";
import { Compass, House } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div
      role="status"
      className="min-h-screen flex flex-col animate-[fadeIn_0.5s_ease-out]"
    >
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-md mx-auto relative px-4 text-center">
          <div className="flex items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
              <Compass className="size-6 text-muted-foreground" aria-hidden />
            </div>
          </div>
          <p className="mt-5 text-5xl sm:text-6xl font-bold text-foreground tracking-tight">
            404
          </p>
          <h1 className="mt-2 text-base sm:text-lg font-medium text-foreground">
            Página não encontrada
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            O endereço que você abriu não existe ou foi movido. Confira o link ou
            volte para o início.
          </p>
          <Button asChild className="mt-6">
            <Link to="/">
              <House className="h-4 w-4" />
              Voltar ao início
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}