/**
 * Landing Page — MikWeb Customer Portal.
 * Minimalist hero with clear call-to-action leading to login.
 */

import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Wifi, ArrowRight, Shield, FileText, Smartphone } from "lucide-react";
import { useNavigate } from "react-router";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-foreground" />
            <span className="text-sm font-medium tracking-tight">MikWeb</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => navigate("/login")}
          >
            Acessar Área do Cliente
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-20">
          <div className="max-w-2xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="flex justify-center mb-8">
                <div className="h-16 w-16 rounded-full bg-foreground flex items-center justify-center">
                  <Wifi className="h-8 w-8 text-background" />
                </div>
              </div>
              <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-foreground leading-tight">
                Bem-vindo à{" "}
                <span className="font-medium">MikWeb</span>
              </h1>
              <p className="text-base text-muted-foreground mt-4 max-w-md mx-auto leading-relaxed">
                Acesse suas faturas, consulte seu histórico de pagamentos
                e gerencie seus serviços de forma simples e rápida.
              </p>

              <div className="mt-10 flex items-center justify-center gap-3">
                <Button
                  className="h-10 px-6 text-sm"
                  onClick={() => navigate("/login")}
                >
                  Entrar
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-10 px-6 text-sm"
                  onClick={() => navigate("/login")}
                >
                  Primeiro acesso
                </Button>
              </div>
            </motion.div>

            {/* Features */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
              className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left"
            >
              {[
                {
                  icon: FileText,
                  title: "Faturas",
                  desc: "Visualize, faça download do PDF e copie o código de barras ou PIX.",
                },
                {
                  icon: Shield,
                  title: "Segurança",
                  desc: "Login protegido com CPF e senha inicial. Sessão segura com criptografia.",
                },
                {
                  icon: Smartphone,
                  title: "Praticidade",
                  desc: "Acesse de qualquer lugar. Design responsivo para celular, tablet e desktop.",
                },
              ].map((feature) => (
                <div key={feature.title} className="p-5 rounded-md border border-border">
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center mb-3">
                    <feature.icon className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            MikWeb — Provedora de Internet &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
