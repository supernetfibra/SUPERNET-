/**
 * Contact Selection Page
 * Shown when a CPF has multiple phone contacts registered.
 * Uses CSS animations instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Phone, Loader2, AlertCircle, Wifi, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBranding } from "@/lib/branding-context";

interface Contact {
  id: string;
  label: string;
  phoneMasked: string;
}

export default function ContactSelect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectContact, error } = useAuth();
  const { providerName, logoUrl } = useBranding();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const contacts = (location.state as any)?.contacts as Contact[] | undefined;

  if (!contacts || contacts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Nenhum contato disponível.</p>
      </div>
    );
  }

  const handleSelect = async (contactId: string) => {
    setSelectedId(contactId);
    setIsSubmitting(true);

    try {
      await selectContact(contactId);
      navigate("/dashboard");
    } catch {
      // Error handled by hook
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
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
        <div className="w-full max-w-md animate-[slideUp_0.4s_ease-out]">
          <Card className="border-border shadow-none">
            <CardHeader className="pb-6 text-center">
              <div className="flex justify-center mb-4">
                <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                  <Phone className="h-6 w-6 text-foreground" />
                </div>
              </div>
              <CardTitle className="text-lg font-medium tracking-tight">
                Selecione seu contato
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Encontramos mais de um telefone cadastrado para seu CPF.
                <br />
                Selecione o número que você usou como senha.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              {contacts.map((contact, index) => (
                <div
                  key={contact.id}
                  className="animate-[slideUp_0.3s_ease-out]"
                  style={{ animationDelay: `${index * 0.08}s` }}
                >
                  <button
                    onClick={() => handleSelect(contact.id)}
                    disabled={isSubmitting}
                    className="w-full flex items-center gap-4 p-4 rounded-md border border-border bg-card hover:bg-secondary transition-colors text-left disabled:opacity-50"
                  >
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {contact.label}
                      </p>
                      <p className="text-sm text-muted-foreground font-mono tracking-wider">
                        {contact.phoneMasked}
                      </p>
                    </div>
                    {isSubmitting && selectedId === contact.id && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </button>
                </div>
              ))}

              {error && (
                <p className="flex items-start gap-2 text-xs text-destructive pt-2 animate-[fadeIn_0.2s_ease-out]">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
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
