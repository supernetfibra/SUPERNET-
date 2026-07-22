/**
 * Profile Page — Shows real customer information from the MikWeb API.
 * Uses CSS animations instead of framer-motion.
 */

import { useEffect, useState } from "react";
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
import {
  User,
  Mail,
  Phone,
  MapPin,
  Wifi,
  Shield,
  LogOut,
  Copy,
  CopyCheck,
  AlertCircle,
  Calendar,
  Bell,
  BellOff,
  Send,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { formatCpf, maskCpf } from "@/lib/cpf";
import { formatPhone } from "@/lib/phone";
import { getTestCustomerData, isTestCpf } from "@/lib/test-user";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface CustomerData {
  id: number;
  full_name: string;
  login: string;
  email?: string;
  cpf_cnpj?: string;
  rg?: string;
  person_type?: string;
  phone_number?: string;
  cell_phone_number_1?: string;
  cell_phone_number_2?: string;
  cell_phone_number_3?: string;
  cell_phone_number_4?: string;
  status: string;
  due_day?: number;
  zip_code?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  server?: { id: number; name: string };
  plan?: { id: number; name: string; value: string };
  financial_status?: string;
}

export default function Profile() {
  const navigate = useNavigate();
  const { logout, customer: sessionCustomer } = useAuth();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch real customer data from the API
  useEffect(() => {
    let cancelled = false;

    const fetchCustomer = async () => {
      try {
        setLoading(true);

        // Build fallback from session info (stable closure, not deps)
        const sessionAsFallback: CustomerData | null = sessionCustomer
          ? {
              id: 0,
              full_name: sessionCustomer.name || "Cliente",
              login: "",
              cpf_cnpj: sessionCustomer.cpf,
              status: "Ativo",
            }
          : null;

        // ---- TEST USER - return mock data ----
        if (sessionCustomer?.id?.startsWith("test-") && isTestCpf(sessionCustomer.cpf)) {
          if (!cancelled) {
            setCustomer(getTestCustomerData() as CustomerData);
            setError(null);
            setLoading(false);
          }
          return;
        }
        // ---- END TEST USER ----

        const response = await fetch("/api/mikweb/customer", {
          credentials: "include",
        });

        let errorDetail = "";
        try {
          const body = await response.clone().json();
          errorDetail = body.error || "";
        } catch {}

        if (!response.ok) {
          throw new Error(errorDetail || `Erro HTTP ${response.status}: Servidor retornou erro ao buscar cliente.`);
        }

        const data = await response.json();
        if (!cancelled) {
          if (!data.customer) {
            console.warn("[PERFIL] Resposta sem customer:", JSON.stringify(data).slice(0, 300));
            // Fallback: show session data instead of error
            if (sessionAsFallback) {
              setCustomer(sessionAsFallback);
              setError(null);
            } else {
              setError("Dados do cliente não encontrados na resposta.");
            }
          } else {
            setCustomer(data.customer);
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[PERFIL_ERRO]", err);
          // Fallback: show session data instead of error
          const sessionAsFallback: CustomerData | null = sessionCustomer
            ? {
                id: 0,
                full_name: sessionCustomer.name || "Cliente",
                login: "",
                cpf_cnpj: sessionCustomer.cpf,
                status: "Ativo",
              }
            : null;
          if (sessionAsFallback) {
            setCustomer(sessionAsFallback);
            setError(null);
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Erro ao conectar com o servidor."
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCustomer();
    return () => { cancelled = true; };
  }, [sessionCustomer]);


  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const handleCopyCpf = async () => {
    if (!customer?.cpf_cnpj) return;
    try {
      await navigator.clipboard.writeText(formatCpf(customer.cpf_cnpj));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // Collect all phone numbers as contacts
  const phoneContacts: Array<{ phone: string; label: string }> = [];
  if (customer?.phone_number) {
    phoneContacts.push({ phone: customer.phone_number, label: "Telefone" });
  }
  if (customer?.cell_phone_number_1) {
    phoneContacts.push({ phone: customer.cell_phone_number_1, label: "Celular 1" });
  }
  if (customer?.cell_phone_number_2) {
    phoneContacts.push({ phone: customer.cell_phone_number_2, label: "Celular 2" });
  }
  if (customer?.cell_phone_number_3) {
    phoneContacts.push({ phone: customer.cell_phone_number_3, label: "Celular 3" });
  }
  if (customer?.cell_phone_number_4) {
    phoneContacts.push({ phone: customer.cell_phone_number_4, label: "Celular 4" });
  }

  // Build full address
  const addressParts = [
    customer?.street,
    customer?.number,
    customer?.complement,
  ].filter(Boolean);
  const addressLine = addressParts.length > 0 ? addressParts.join(", ") : null;
  const neighborhoodLine = [
    customer?.neighborhood,
    customer?.city && customer?.state
      ? `${customer.city}/${customer.state}`
      : customer?.city || customer?.state,
  ]
    .filter(Boolean)
    .join(" — ");

  // Loading skeleton
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Skeleton header */}
        <div className="space-y-2">
          <div className="h-6 w-16 bg-secondary/60 rounded-sm animate-pulse" />
          <div className="h-4 w-44 bg-secondary/40 rounded-sm animate-pulse" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Main card skeleton */}
          <div className="md:col-span-2">
            <Card className="border-border shadow-none">
              <CardContent className="p-5 space-y-4">
                {/* Avatar + name row */}
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-secondary/50 animate-pulse shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-5 w-40 bg-secondary/60 rounded-sm animate-pulse" />
                    <div className="h-3 w-24 bg-secondary/40 rounded-sm animate-pulse" />
                  </div>
                  <div className="h-5 w-16 bg-secondary/40 rounded-full animate-pulse shrink-0" />
                </div>
                <div className="h-px bg-border" />

                {/* Info rows */}
                {[1, 2, 3, 4].map((i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <div className="h-3.5 w-3.5 bg-secondary/40 rounded-sm animate-pulse shrink-0" />
                        <div className="h-3 w-16 bg-secondary/40 rounded-sm animate-pulse" />
                      </div>
                      <div className="h-3 w-32 bg-secondary/40 rounded-sm animate-pulse" />
                    </div>
                    <div className="h-px bg-border mt-3" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar skeleton */}
          <div className="space-y-4">
            <Card className="border-border shadow-none">
              <CardContent className="p-5 space-y-3">
                <div className="h-4 w-20 bg-secondary/60 rounded-sm animate-pulse" />
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-secondary/40 animate-pulse shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 w-16 bg-secondary/40 rounded-sm animate-pulse" />
                      <div className="h-2.5 w-28 bg-secondary/30 rounded-sm animate-pulse" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-border shadow-none">
              <CardContent className="p-5">
                <div className="h-4 w-14 bg-secondary/60 rounded-sm animate-pulse mb-3" />
                <div className="h-9 w-full bg-secondary/40 rounded-md animate-pulse" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !customer) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-foreground">
            Erro ao carregar perfil
          </p>
          <p className="text-xs text-muted-foreground">
            {error || "Cliente não encontrado."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  const planName = customer.plan?.name || "—";
  const isActive = customer.status?.toLowerCase() === "ativo";
  const statusLabel =
    customer.financial_status || customer.status || "Ativo";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Perfil
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seus dados cadastrados.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer Info */}
        <div className="md:col-span-2 animate-[slideUp_0.3s_ease-out_0.05s_both]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-lg font-medium text-foreground">
                    {customer.full_name?.charAt(0).toUpperCase() || "?"}
                  </span>
                </div>
                <div>
                  <CardTitle className="text-base font-medium">
                    {customer.full_name || "Cliente"}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    {customer.login && `Login: ${customer.login}`}
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={`ml-auto text-[10px] font-medium px-2 py-0.5 border-none ${
                    isActive
                      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400"
                      : "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400"
                  }`}
                >
                  <Wifi className="h-3 w-3 mr-1" />
                  {statusLabel}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CPF */}
              {customer.cpf_cnpj && (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1 sm:gap-0">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {customer.person_type === "juridica"
                          ? "CNPJ"
                          : "CPF"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-xs sm:text-sm">
                        {formatCpf(customer.cpf_cnpj)}
                      </span>
                      <button
                        onClick={handleCopyCpf}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
                </>
              )}

              {/* Email */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1 sm:gap-0">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span>E-mail</span>
                </div>
                <span className="text-foreground break-all text-xs sm:text-sm">
                  {customer.email || "—"}
                </span>
              </div>
              <Separator />

              {/* Phone */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1 sm:gap-0">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span>Telefone</span>
                </div>
                <span className="text-foreground text-xs sm:text-sm">
                  {customer.phone_number
                    ? formatPhone(customer.phone_number)
                    : customer.cell_phone_number_1
                    ? formatPhone(customer.cell_phone_number_1)
                    : "—"}
                </span>
              </div>
              <Separator />

              {/* Address */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between text-sm gap-1 sm:gap-0">
                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Endereço</span>
                </div>
                <span className="text-foreground text-right text-xs sm:text-sm w-full sm:max-w-[250px]">
                  {addressLine || "—"}
                  {addressLine && <br />}
                  {neighborhoodLine && (
                    <span>
                      {neighborhoodLine}
                      <br />
                    </span>
                  )}
                  {customer.zip_code && (
                    <span className="text-xs text-muted-foreground">
                      CEP: {customer.zip_code}
                    </span>
                  )}
                </span>
              </div>
              <Separator />

              {/* Plan */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1 sm:gap-0">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wifi className="h-3.5 w-3.5 shrink-0" />
                  <span>Plano</span>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium border-border w-fit sm:w-auto"
                >
                  {planName}
                </Badge>
              </div>

              {/* Vencimento */}
              {customer.due_day && (
                <>
                  <Separator />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1 sm:gap-0">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>Vencimento</span>
                    </div>
                    <span className="text-foreground text-xs sm:text-sm">
                      Dia {customer.due_day}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 animate-[slideUp_0.3s_ease-out_0.1s_both]">
          {/* Contacts */}
          {phoneContacts.length > 0 && (
            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Contatos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {phoneContacts.map((contact, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {contact.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatPhone(contact.phone)}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Notifications */}
          <NotificationCard />

          {/* Account Actions */}
          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Conta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
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
        </div>
      </div>
    </div>
  );
}

/**
 * NotificationCard — Push notification toggle UI component.
 * Lets users enable/disable push notifications for billing reminders.
 */
function NotificationCard() {
  const {
    status,
    isSubscribed,
    isLoading,
    error,
    toggleSubscription,
    isSupported,
  } = usePushNotifications();
  const { toast } = useToast();

  const handleToggle = async () => {
    const result = await toggleSubscription();
    if (result) {
      toast({
        title: isSubscribed
          ? "Notificações desativadas"
          : "Notificações ativadas!",
        description: isSubscribed
          ? "Você não receberá mais lembretes de faturas."
          : "Você receberá lembretes de faturas pendentes.",
        variant: "success",
      });
    } else if (status === "denied") {
      toast({
        title: "Notificações bloqueadas",
        description:
          "Permita notificações nas configurações do navegador para receber lembretes.",
        variant: "destructive",
      });
    }
  };

  const sendTestNotification = async () => {
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (res.ok) {
        toast({
          title: "Teste enviado!",
          description: "Verifique se a notificação chegou.",
          variant: "success",
        });
      } else {
        toast({
          title: "Erro ao enviar teste",
          description: "Tente novamente mais tarde.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Erro de conexão",
        description: "Não foi possível enviar o teste.",
        variant: "destructive",
      });
    }
  };

  // Show nothing if push is not supported
  if (!isSupported) return null;

  const isDisabled = isLoading || status === "denied";

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          Notificações
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground">
          Receba lembretes de faturas pendentes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="push-toggle" className="text-xs cursor-pointer">
            {isSubscribed ? "Ativado" : "Desativado"}
          </Label>
          <Switch
            id="push-toggle"
            checked={isSubscribed}
            onCheckedChange={handleToggle}
            disabled={isDisabled}
          />
        </div>

        {error && (
          <p className="text-[10px] text-destructive leading-relaxed">
            {error}
          </p>
        )}

        {status === "denied" && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
            Notificações bloqueadas neste navegador. Para ativar, permita
            notificações nas configurações do site.
          </p>
        )}

        {isSubscribed && (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-8"
            onClick={sendTestNotification}
          >
            <Send className="h-3 w-3 mr-2" />
            Enviar notificação de teste
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
