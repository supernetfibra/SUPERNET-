/**
 * Profile Page — Shows customer information, contacts, and account details.
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Wifi,
  Shield,
  Calendar,
  LogOut,
  Copy,
  CopyCheck,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { formatCpf } from "@/lib/cpf";
import { useState } from "react";

// Mock data — replace with Convex API calls
const MOCK_CUSTOMER = {
  name: "João Silva",
  cpf: "12345678901",
  email: "joao.silva@email.com",
  endereco: "Rua das Flores, 123",
  bairro: "Centro",
  cidade: "São Paulo",
  estado: "SP",
  cep: "01001-001",
  telefone: "(11) 91234-5678",
  contatos: [
    { id: "1", nome: "João Silva", telefone: "(11) 91234-5678", tipo: "Principal" },
    { id: "2", nome: "Maria Silva", telefone: "(11) 98765-4321", tipo: "Recado" },
  ],
  planos: ["Internet 300MB Fibra"],
  status: "Ativo",
  clienteDesde: "Jan 2024",
};

export default function Profile() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [copied, setCopied] = useState(false);

  const customer = MOCK_CUSTOMER;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleCopyCpf = async () => {
    try {
      await navigator.clipboard.writeText(formatCpf(customer.cpf));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">Perfil</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seus dados cadastrados na MikWeb.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer Info */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          className="md:col-span-2"
        >
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-lg font-medium text-foreground">
                    {customer.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <CardTitle className="text-base font-medium">{customer.name}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Cliente desde {customer.clienteDesde}
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className="ml-auto text-[10px] font-medium px-2 py-0.5 border-none text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400"
                >
                  <Wifi className="h-3 w-3 mr-1" />
                  {customer.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CPF */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  <span>CPF</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-foreground">{formatCpf(customer.cpf)}</span>
                  <button
                    onClick={handleCopyCpf}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <CopyCheck className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <Separator />

              {/* Email */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <span>E-mail</span>
                </div>
                <span className="text-foreground">{customer.email || "—"}</span>
              </div>
              <Separator />

              {/* Phone */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  <span>Telefone</span>
                </div>
                <span className="text-foreground">{customer.telefone}</span>
              </div>
              <Separator />

              {/* Address */}
              <div className="flex items-start justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 mt-0.5" />
                  <span>Endereço</span>
                </div>
                <span className="text-foreground text-right max-w-[250px]">
                  {customer.endereco}, {customer.bairro} — {customer.cidade}/{customer.estado}
                  <br />
                  <span className="text-xs text-muted-foreground">CEP: {customer.cep}</span>
                </span>
              </div>
              <Separator />

              {/* Plan */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wifi className="h-3.5 w-3.5" />
                  <span>Plano</span>
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  {customer.planos.map((plano) => (
                    <Badge
                      key={plano}
                      variant="outline"
                      className="text-[10px] font-medium border-border"
                    >
                      {plano}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Sidebar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="space-y-4"
        >
          {/* Contacts */}
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Contatos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer.contatos.map((contact) => (
                <div key={contact.id} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {contact.nome}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{contact.telefone}</p>
                  </div>
                  {contact.tipo === "Principal" && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 border-none bg-secondary text-muted-foreground ml-auto"
                    >
                      Principal
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Account Actions */}
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Conta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-9"
                onClick={() => {
                  // Change password action
                }}
              >
                <Shield className="h-3.5 w-3.5 mr-2" />
                Alterar senha
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-9 text-destructive hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5 mr-2" />
                Sair da conta
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
