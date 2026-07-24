/**
 * Admin Login Page — Redireciona para a página de login padrão.
 * O login administrativo agora usa a mesma tela de CPF + senha dos clientes,
 * com um CPF específico (000.000.000-00) e senha dedicada.
 * 
 * Acesse /login, informe o CPF 000.000.000-00 e a senha de administrador.
 */

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Se já estiver autenticado como admin, vai direto pro dashboard
    if (!isLoading && isAuthenticated) {
      const adminToken = localStorage.getItem("mikweb_admin_token");
      if (adminToken) {
        navigate("/admin/dashboard");
        return;
      }
    }
    // Redireciona para a página de login padrão
    if (!isLoading) {
      navigate("/login");
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Exibe spinner enquanto carrega para evitar flash de tela branca
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
