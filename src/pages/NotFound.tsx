/**
 * NotFound Page — Simple 404 page.
 * Uses CSS animations instead of framer-motion.
 */

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col animate-[fadeIn_0.5s_ease-out]">
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-5xl mx-auto relative px-4">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center">
              <h1 className="text-5xl sm:text-6xl font-bold text-foreground mb-3">404</h1>
              <p className="text-base sm:text-lg text-muted-foreground">Página não encontrada</p>
              <a href="/" className="inline-block mt-6 text-sm text-muted-foreground hover:text-foreground underline transition-colors">
                Voltar ao início
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
