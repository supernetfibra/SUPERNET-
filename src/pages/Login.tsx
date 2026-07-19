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
import { ArrowRight, Loader2, AlertCircle, Wifi, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { normalizeCpf, formatCpf, isValidCpf } from "@/lib/cpf";
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
  const [keepConnected, setKeepConnected] = useState(false);
  const [cpfTouched, setCpfTouched] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const cpfDigits = normalizeCpf(cpf);
  const cpfValid = cpfDigits.length === 11 && isValidCpf(cpfDigits);
  const cpfComplete = cpfDigits.length === 11;
  const showCpfError = cpfTouched && cpfDigits.length > 0 && !cpfComplete;
  const showCpfSuccess = cpfTouched && cpfValid;

  const handleCpfSubmit = (e: FormEvent) => {
    e.preventDefault();
    setCpfTouched(true);
    clearError();

    const normalized = normalizeCpf(cpf);
    if (normalized.length !== 11 || !isValidCpf(normalized)) {
      return;
    }

    setStep("password");
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setIsSubmitting(true);

    try {
      await login(normalizeCpf(cpf), password, keepConnected);
      navigate("/dashboard");
    } catch {
      // Error is handled by the auth hook
    } finally {
      setIsSubmitting(false);
    }
  };
  // Focus the password input when step transitions to "password"
  useEffect(() => {
    if (step === "password" && passwordRef.current) {
      // Small delay to let the CSS transition start before focusing
      const timer = setTimeout(() => {
        passwordRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const goBack = () => {
    setStep("cpf");
    clearError();
  };

  const handleCpfInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    setCpf(digits);
    if (!cpfTouched && digits.length > 0) {
      setCpfTouched(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={providerName} className="h-5 w-5 rounded-full object-cover" />
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
                  : `Use os 4 últimos dígitos do seu CPF como senha inicial.`}
              </CardDescription>
            </CardHeader>

            <CardContent className="relative overflow-hidden">
              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 mb-6">
                <div className={`h-1.5 w-8 rounded-full transition-colors duration-300 ${
                  step === "cpf" ? "bg-foreground" : "bg-muted-foreground/30"
                }`} />
                <div className={`h-1.5 w-8 rounded-full transition-colors duration-300 ${
                  step === "password" ? "bg-foreground" : "bg-muted-foreground/30"
                }`} />
              </div>

              {/* CPF Step */}
              <div
                className={`transition-all duration-300 ease-in-out ${
                  step === "cpf"
                    ? "opacity-100 translate-y-0 max-h-96"
                    : "opacity-0 translate-y-2 max-h-0 pointer-events-none"
                }`}
              >
                <form onSubmit={handleCpfSubmit}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cpf" className="text-xs font-medium text-muted-foreground">
                        CPF
                      </Label>
                      <div className="relative">
                        <Input
                          id="cpf"
                          type="text"
                          inputMode="numeric"
                          placeholder="000.000.000-00"
                          value={formatCpf(cpf)}
                          onChange={(e) => handleCpfInput(e.target.value)}
                          onBlur={() => setCpfTouched(true)}
                          className={`h-10 text-sm tracking-wider pr-10 transition-all duration-200 ${
                            showCpfSuccess
                              ? "border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-400/20"
                              : showCpfError
                              ? "border-destructive/60 ring-1 ring-destructive/20"
                              : ""
                          }`}
                          autoFocus
                          autoComplete="off"
                          required
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {showCpfSuccess && (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 animate-[fadeIn_0.2s_ease-out]" />
                          )}
                          {showCpfError && (
                            <AlertCircle className="h-4 w-4 text-destructive/70 animate-[fadeIn_0.2s_ease-out]" />
                          )}
                        </div>
                      </div>
                      {showCpfError && (
                        <p className="flex items-center gap-1.5 text-[11px] text-destructive/80 animate-[fadeIn_0.2s_ease-out]">
                          <AlertCircle className="h-3 w-3" />
                          CPF deve ter 11 dígitos
                        </p>
                      )}
                      {showCpfSuccess && (
                        <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 animate-[fadeIn_0.2s_ease-out]">
                          <CheckCircle2 className="h-3 w-3" />
                          CPF válido
                        </p>
                      )}
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
                      disabled={!cpfComplete}
                    >
                      Continuar
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </div>

              {/* Password Step */}
              <div
                className={`transition-all duration-300 ease-in-out ${
                  step === "password"
                    ? "opacity-100 translate-y-0 max-h-96"
                    : "opacity-0 translate-y-2 max-h-0 pointer-events-none"
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
                          ref={passwordRef}
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Últimos 4 dígitos do CPF"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="h-10 text-sm pr-10"
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
                        Sua senha inicial são os 4 últimos dígitos do seu CPF.
                      </p>
                    </div>

                    {error && (
                      <p className="flex items-start gap-2 text-xs text-destructive animate-[fadeIn_0.2s_ease-out]">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <input
                        id="keep-connected"
                        type="checkbox"
                        checked={keepConnected}
                        onChange={(e) => setKeepConnected(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 accent-foreground"
                      />
                      <Label htmlFor="keep-connected" className="text-xs text-muted-foreground cursor-pointer select-none">
                        Manter conectado
                      </Label>
                    </div>

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            {providerName} — Provedora de Internet &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
