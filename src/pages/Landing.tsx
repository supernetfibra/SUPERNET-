/**
 * Landing Page — MikWeb Customer Portal.
 * Minimalist hero with clear CTAs: login for existing customers and a new
 * installation request form for potential customers.
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wifi,
  ArrowRight,
  Shield,
  FileText,
  Smartphone,
  Home,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Send,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useBranding } from "@/lib/branding-context";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { submitInstallRequest } from "@/lib/install-request";

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
];

export default function Landing() {
  const navigate = useNavigate();
  const { providerName, logoUrl } = useBranding();

  const {
    pullContainerProps,
    PullIndicator,
  } = usePullToRefresh(false, () => window.location.reload());

  // Installation request form state
  const [form, setForm] = useState({
    fullName: "",
    cpf: "",
    phone: "",
    email: "",
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    desiredPlan: "",
    message: "",
    website: "", // honeypot — hidden from humans, bots fill it
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const update =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const scrollToForm = () => {
    document
      .getElementById("solicitar-instalacao")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetForm = () => {
    setForm({
      fullName: "",
      cpf: "",
      phone: "",
      email: "",
      zipCode: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
      desiredPlan: "",
      message: "",
      website: "",
    });
    setAgreedToTerms(false);
    setFormError(null);
    setSubmitted(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const fullName = form.fullName.trim();
    const cpf = form.cpf.replace(/\D/g, "");
    const phone = form.phone.replace(/\D/g, "");

    if (fullName.length < 3) {
      setFormError("Informe seu nome completo.");
      return;
    }
    if (cpf.length !== 11) {
      setFormError("Informe um CPF válido com 11 dígitos.");
      return;
    }
    if (phone.length < 10) {
      setFormError("Informe um telefone válido com DDD.");
      return;
    }
    if (!agreedToTerms) {
      setFormError("Você precisa aceitar os termos para continuar.");
      return;
    }

    setSubmitting(true);
    const result = await submitInstallRequest({
      fullName,
      cpf,
      phone,
      email: form.email.trim() || undefined,
      zipCode: form.zipCode.trim() || undefined,
      street: form.street.trim() || undefined,
      number: form.number.trim() || undefined,
      complement: form.complement.trim() || undefined,
      neighborhood: form.neighborhood.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state || undefined,
      desiredPlan: form.desiredPlan.trim() || undefined,
      message: form.message.trim() || undefined,
      agreedToTerms,
      website: form.website,
    });
    setSubmitting(false);

    if (result.ok) {
      setSubmitted(true);
      requestAnimationFrame(() =>
        document
          .getElementById("solicitar-instalacao")
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } else {
      setFormError(result.error || "Não foi possível enviar a solicitação.");
    }
  };

  return (
    <div
      {...pullContainerProps}
      className="min-h-screen flex flex-col bg-background relative"
    >
      <PullIndicator />
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
        <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-16 sm:py-20">
          <div className="max-w-2xl mx-auto text-center">
            <div className="animate-[slideUp_0.5s_ease-out]">
              <div className="flex justify-center mb-8">
                {logoUrl ? (
                  <img src={logoUrl} alt={providerName} className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-foreground flex items-center justify-center">
                    <Wifi className="h-8 w-8 text-background" />
                  </div>
                )}
              </div>
              <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-foreground leading-tight">
                Bem-vindo(a)
              </h1>
              <p className="text-base text-muted-foreground mt-4 max-w-md mx-auto leading-relaxed">
                Acesse suas faturas, consulte seu histórico de pagamentos
                e gerencie seus serviços de forma simples e rápida.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button
                  className="h-10 px-6 text-sm w-full sm:w-auto"
                  onClick={() => navigate("/login")}
                >
                  Entrar
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-10 px-6 text-sm w-full sm:w-auto"
                  onClick={scrollToForm}
                >
                  <Home className="mr-2 h-4 w-4" />
                  Solicitar Instalação
                </Button>
              </div>
            </div>

            {/* Features */}              <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-left animate-[slideUp_0.5s_ease-out_0.2s_both]">
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
            </div>
          </div>
        </div>

        {/* Installation request section */}
        <section id="solicitar-instalacao" className="border-t border-border scroll-mt-6">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
            {submitted ? (
              <div className="text-center animate-[fadeIn_0.3s_ease-out]">
                <div className="flex justify-center mb-6">
                  <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
                <h2 className="text-2xl font-light tracking-tight text-foreground">
                  Solicitação enviada!
                </h2>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-md mx-auto">
                  Recebemos seus dados e entraremos em contato em breve para
                  agendar a instalação.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-8 text-xs h-9"
                  onClick={resetForm}
                >
                  Enviar nova solicitação
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card p-6 sm:p-8 animate-[fadeIn_0.3s_ease-out]">
                <div className="text-center mb-8">
                  <div className="flex justify-center mb-4">
                    <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                      <Home className="h-5 w-5 text-foreground" />
                    </div>
                  </div>
                  <h2 className="text-xl font-light tracking-tight text-foreground">
                    Solicite sua instalação
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    Preencha seus dados e nossa equipe entrará em contato.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {/* Honeypot — invisible to humans, bots fill it */}
                  <input
                    type="text"
                    name="website"
                    value={form.website}
                    onChange={update("website")}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="absolute -left-[9999px] h-0 w-0 opacity-0"
                  />

                  <div className="space-y-2">
                    <Label
                      htmlFor="ir-fullname"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Nome completo
                    </Label>
                    <Input
                      id="ir-fullname"
                      type="text"
                      placeholder="Seu nome"
                      value={form.fullName}
                      onChange={update("fullName")}
                      className="h-10 text-sm"
                      autoComplete="name"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-cpf"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        CPF
                      </Label>
                      <Input
                        id="ir-cpf"
                        type="text"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        value={form.cpf}
                        onChange={update("cpf")}
                        className="h-10 text-sm font-mono"
                        maxLength={14}
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-phone"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        WhatsApp / Telefone
                      </Label>
                      <Input
                        id="ir-phone"
                        type="tel"
                        inputMode="tel"
                        placeholder="(00) 00000-0000"
                        value={form.phone}
                        onChange={update("phone")}
                        className="h-10 text-sm font-mono"
                        maxLength={15}
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="ir-email"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      E-mail <span className="text-muted-foreground/50">(opcional)</span>
                    </Label>
                    <Input
                      id="ir-email"
                      type="email"
                      placeholder="voce@email.com"
                      value={form.email}
                      onChange={update("email")}
                      className="h-10 text-sm"
                      autoComplete="email"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-zip"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        CEP
                      </Label>
                      <Input
                        id="ir-zip"
                        type="text"
                        inputMode="numeric"
                        placeholder="00000-000"
                        value={form.zipCode}
                        onChange={update("zipCode")}
                        className="h-10 text-sm font-mono"
                        maxLength={9}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label
                        htmlFor="ir-city"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Cidade
                      </Label>
                      <Input
                        id="ir-city"
                        type="text"
                        placeholder="Sua cidade"
                        value={form.city}
                        onChange={update("city")}
                        className="h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-street"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Endereço
                      </Label>
                      <Input
                        id="ir-street"
                        type="text"
                        placeholder="Rua / Avenida"
                        value={form.street}
                        onChange={update("street")}
                        className="h-10 text-sm"
                        autoComplete="street-address"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-number"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Número
                      </Label>
                      <Input
                        id="ir-number"
                        type="text"
                        placeholder="123"
                        value={form.number}
                        onChange={update("number")}
                        className="h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-complement"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Complemento <span className="text-muted-foreground/50">(opcional)</span>
                      </Label>
                      <Input
                        id="ir-complement"
                        type="text"
                        placeholder="Apto, bloco..."
                        value={form.complement}
                        onChange={update("complement")}
                        className="h-10 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-neighborhood"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Bairro
                      </Label>
                      <Input
                        id="ir-neighborhood"
                        type="text"
                        placeholder="Seu bairro"
                        value={form.neighborhood}
                        onChange={update("neighborhood")}
                        className="h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-state"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Estado
                      </Label>
                      <Select
                        value={form.state}
                        onValueChange={(v) => setForm((f) => ({ ...f, state: v }))}
                      >
                        <SelectTrigger id="ir-state" className="h-10 text-sm">
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {BRAZILIAN_STATES.map((uf) => (
                            <SelectItem key={uf} value={uf} className="text-xs">
                              {uf}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="ir-plan"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Plano desejado <span className="text-muted-foreground/50">(opcional)</span>
                      </Label>
                      <Input
                        id="ir-plan"
                        type="text"
                        placeholder="Ex: 300 Mega"
                        value={form.desiredPlan}
                        onChange={update("desiredPlan")}
                        className="h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="ir-message"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Observação <span className="text-muted-foreground/50">(opcional)</span>
                    </Label>
                    <Textarea
                      id="ir-message"
                      placeholder="Alguma informação que queira compartilhar..."
                      value={form.message}
                      onChange={update("message")}
                      className="min-h-20 text-sm"
                      maxLength={500}
                    />
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                    <Checkbox
                      checked={agreedToTerms}
                      onCheckedChange={(v) => setAgreedToTerms(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-muted-foreground leading-relaxed">
                      Li e concordo com os{" "}
                      <span className="text-foreground underline underline-offset-2">
                        termos de uso
                      </span>{" "}
                      e a política de privacidade do {providerName}.
                    </span>
                  </label>

                  {formError && (
                    <p className="flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{formError}</span>
                    </p>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-11 text-sm mt-2"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {submitting ? "Enviando..." : "Enviar solicitação"}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            {providerName} — Provedora de Internet &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
