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
  Camera,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TermsOfUseContent from "@/components/terms-content";
import PrivacyContent from "@/components/privacy-content";
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
  const [termsOpen, setTermsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Photo state (base64 data URLs)
  const [photos, setPhotos] = useState<{
    houseFront: string | null;
    street: string | null;
    idFront: string | null;
    idBack: string | null;
  }>({ houseFront: null, street: null, idFront: null, idBack: null });

  /** Compress and resize an image file to a base64 data URL (max ~600KB). */
  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let { width, height } = img;
          if (width > MAX_WIDTH || height > MAX_HEIGHT) {
            const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
          // Compress to JPEG quality 0.7
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = () => reject(new Error("Falha ao carregar imagem"));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });

  const handlePhoto = (
    key: keyof typeof photos
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) {
      setFormError("Imagem muito grande. Máximo 10MB.");
      return;
    }
    try {
      const compressed = await compressImage(file);
      setPhotos((p) => ({ ...p, [key]: compressed }));
    } catch {
      setFormError("Erro ao processar imagem. Tente outra foto.");
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const removePhoto = (key: keyof typeof photos) => () => {
    setPhotos((p) => ({ ...p, [key]: null }));
  };

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
    setPhotos({ houseFront: null, street: null, idFront: null, idBack: null });
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
      photoHouseFront: photos.houseFront || undefined,
      photoStreet: photos.street || undefined,
      photoIdFront: photos.idFront || undefined,
      photoIdBack: photos.idBack || undefined,
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

                  {/* Photo uploads */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Fotos <span className="text-muted-foreground/50">(opcional, mas ajuda na avaliação)
                    </span>
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Envie fotos da frente da casa, da rua e da sua identidade (frente e verso).
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ["houseFront", "Frente da casa"],
                        ["street", "Rua"],
                        ["idFront", "Identidade (frente)"],
                        ["idBack", "Identidade (verso)"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          {photos[key] ? (
                            <div className="relative group">
                              <img
                                src={photos[key]!}
                                alt={label}
                                className="w-full h-24 object-cover rounded-sm border border-border"
                              />
                              <button
                                type="button"
                                onClick={removePhoto(key)}
                                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              <p className="text-[9px] text-muted-foreground mt-0.5 truncate">
                                {label}
                              </p>
                            </div>
                          ) : (
                            <label className="flex flex-col items-center justify-center h-24 rounded-sm border border-dashed border-border/80 hover:border-foreground/30 cursor-pointer transition-colors bg-secondary/20">
                              <Camera className="h-4 w-4 text-muted-foreground/60 mb-1" />
                              <span className="text-[10px] text-muted-foreground text-center leading-tight px-1">
                                {label}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="sr-only"
                                onChange={handlePhoto(key)}
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                    <Checkbox
                      checked={agreedToTerms}
                      onCheckedChange={(v) => setAgreedToTerms(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-muted-foreground leading-relaxed">
                      Li e concordo com os{" "}
                      <button
                        type="button"
                        onClick={() => setTermsOpen(true)}
                        className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                      >
                        termos de uso
                      </button>{" "}
                      e a{" "}
                      <button
                        type="button"
                        onClick={() => setPrivacyOpen(true)}
                        className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                      >
                        política de privacidade
                      </button>{" "}
                      do {providerName}.
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

      {/* Terms of Use dialog */}
      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termos de Uso</DialogTitle>
          </DialogHeader>
          <TermsOfUseContent />
        </DialogContent>
      </Dialog>

      {/* Privacy Policy dialog */}
      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Política de Privacidade</DialogTitle>
          </DialogHeader>
          <PrivacyContent />
        </DialogContent>
      </Dialog>
    </div>
  );
}
