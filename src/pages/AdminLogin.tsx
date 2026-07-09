/**
 * Admin Login Page — Discreet access to the admin dashboard.
 * Accessed via a tiny link on the bottom of the login page.
 *
 * Stores the session token in localStorage so the AdminDashboard
 * can authenticate even when Secure cookies are rejected (HTTP dev env).
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
import {
  Shield,
  ArrowRight,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Wifi,
} from "lucide-react";
import { useState, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useBranding } from "@/lib/branding-context";

const ADMIN_TOKEN_KEY = "mikweb_admin_token";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { providerName, logoUrl } = useBranding();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Track mounted state to prevent setState after unmount/during navigation.
  // This prevents the React 19 "removeChild" crash that occurs when a
  // component tries to update state while being unmounted by a route transition.
  const isMountedRef = useRef(true);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (isMountedRef.current) {
          setError(data.error || "Senha incorreta.");
        }
        return;
      }

      // Store the session token in localStorage as a fallback for when
      // the Secure cookie is rejected by the browser (HTTP dev env).
      if (data.sessionToken) {
        localStorage.setItem(ADMIN_TOKEN_KEY, data.sessionToken);
      }

      // Navigate IMMEDIATELY without any subsequent state updates.
      // This prevents the removeChild crash caused by setState on an
      // unmounting component during route transition.
      navigate("/admin/dashboard");
    } catch {
      if (isMountedRef.current) {
        setError("Erro ao conectar com o servidor.");
        setIsLoading(false);
      }
    }
    // Intentionally NO finally block — on success the component unmounts
    // via navigate(), and calling setIsLoading(false) would trigger a
    // state update on an unmounting component, causing removeChild errors.
  };

  return (
    <div className="min-h-screen flex flex-col bg-background animate-[fadeIn_0.3s_ease-out]">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={providerName} className="h-5 w-auto opacity-60" />
            ) : (
              <Wifi className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium tracking-tight text-muted-foreground">
              {providerName}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground tracking-widest uppercase">
            Administração
          </span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-[slideUp_0.4s_ease-out]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-6 text-center">
              <div className="flex justify-center mb-4">
                <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                  <Shield className="h-6 w-6 text-muted-foreground" />
                </div>
              </div>
              <CardTitle className="text-lg font-medium tracking-tight text-foreground">
                Acesso Administrativo
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Área restrita. Informe a senha de administrador.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="admin-password"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Senha de administrador
                  </Label>
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 text-sm font-mono tracking-widest"
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
                  disabled={isLoading || !password}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    <>
                      Acessar painel
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <button
            onClick={() => navigate("/login")}
            className="mt-6 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
          >
            <ArrowLeft className="h-3 w-3" />
            Voltar ao login
          </button>
        </div>
      </div>
    </div>
  );
}
