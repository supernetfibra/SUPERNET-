/**
 * Login Page — CPF + Phone (password) authentication.
 * Minimalist design with clean form, clear error messages.
 * Uses CSS transitions instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight, Loader2, AlertCircle, Wifi, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { normalizeCpf, formatCpf } from "@/lib/cpf";
import { useAuth } from "@/lib/auth-context";
import { useBranding } from "@/lib/branding-context";

type Step = "cpf" | "password";

export default function Login() {
  const navigate = useNavigate();
  const { login, error, clearError } = useAuth();
  const { providerName, logoUrl } = useBranding();

  const [step, setStep] = useState<Step>("cpf");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCpfSubmit = (e: FormEvent) => {
    e.preventDefault();
    clearError();

    const normalized = normalizeCpf(cpf);
    if (normalized.length !== 11) {
      return;
    }

    setStep("password");
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setIsSubmitting(true);

    try {
      const result = await login(normalizeCpf(cpf), password);

      if (result?.hasMultipleContacts && result?.contacts?.length > 0) {
        navigate("/selecao-contato", {
          state: {
            contacts: result.contacts,
            sessionToken: result.sessionToken,
          },
        });
      } else {
        navigate("/dashboard");
      }
    } catch {
      // Error is handled by the auth hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => {
    setStep("cpf");
    clearError();
  };

  const handleCpfInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    setCpf(digits);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={providerName} className="h-6 w-auto" />
            ) : (
              <Wifi className="h-5 w-5 text-foreground" />
            )}
            <span className="text-sm font-medium tracking-tight">{providerName}</span>
          </div>
          <span className="text-xs text-muted-foreground">Área do Cliente</span>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-[slideUp_0.4s_ease-out]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-6 text-center">
              <div className="flex justify-center mb-4">
                {logoUrl ? (
                  <img src={logoUrl} alt={providerName} className="h-12 w-12 rounded-full object-contain" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-foreground flex items-center justify-center">
                    <Wifi className="h-6 w-6 text-background" />
                  </div>
                )}
              </div>
              <CardTitle className="text-lg font-medium tracking-tight">
                {step === "cpf" ? "Acessar Área do Cliente" : "Digite sua senha"}
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {step === "cpf"
                  ? "Informe seu CPF para continuar."
                  : `Use seu número de telefone cadastrado como senha inicial.`}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {/* CPF Step */}
              <div
                className={`transition-all duration-200 ${
                  step === "cpf" ? "opacity-100" : "opacity-0 hidden"
                }`}
              >
                <form onSubmit={handleCpfSubmit}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cpf" className="text-xs font-medium text-muted-foreground">
                        CPF
                      </Label>
                      <Input
                        id="cpf"
                        type="text"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        value={formatCpf(cpf)}
                        onChange={(e) => handleCpfInput(e.target.value)}
                        className="h-10 text-sm tracking-wider"
                        autoFocus
                        autoComplete="off"
                        required
                      />
                    </div>

                    {error && (
                      <p className="flex items-start gap-2 text-xs text-destructive animate-[fadeIn_0.2s_ease-out]">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}

                    <Button
                      type="submit"
                      className="w-full h-10 text-sm"
                      disabled={normalizeCpf(cpf).length !== 11}
                    >
                      Continuar
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </div>

              {/* Password Step */}
              <div
                className={`transition-all duration-200 ${
                  step === "password" ? "opacity-100" : "opacity-0 hidden"
                }`}
              >
                <form onSubmit={handlePasswordSubmit}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        CPF: <span className="font-medium text-foreground">{formatCpf(cpf)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={goBack}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        Alterar
                      </button>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                        Senha inicial
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Telefone cadastrado"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="h-10 text-sm pr-10"
                          autoFocus
                          autoComplete="off"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Sua senha inicial é o número de telefone que você cadastrou em seu provedor.
                      </p>
                    </div>

                    {error && (
                      <p className="flex items-start gap-2 text-xs text-destructive animate-[fadeIn_0.2s_ease-out]">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}

                    <Button
                      type="submit"
                      className="w-full h-10 text-sm"
                      disabled={isSubmitting || password.length < 3}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Verificando...
                        </>
                      ) : (
                        <>
                          Entrar
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-8">
            Ao acessar, você concorda com nossos{" "}
            <button className="underline hover:text-foreground transition-colors">
              Termos de Uso
            </button>{" "}
            e{" "}
            <button className="underline hover:text-foreground transition-colors">
              Política de Privacidade
            </button>
            .
          </p>

          {/* Discreet admin link */}
          <div className="flex justify-center mt-6">
            <button
              onClick={() => navigate("/admin")}
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors tracking-wider uppercase"
            >
              Administração
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 h-10 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            {providerName} — Provedora de Internet &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
