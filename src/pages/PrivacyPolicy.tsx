/**
 * Privacy Policy Page — standalone route for direct URL access.
 */

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import PrivacyContent from "@/components/privacy-content";

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar
        </button>

        <h1 className="text-2xl font-light tracking-tight text-foreground mb-2">
          Política de Privacidade
        </h1>

        <PrivacyContent />

        <div className="mt-12 pt-6 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-3 w-3 mr-1.5" />
            Voltar
          </Button>
        </div>
      </div>
    </div>
  );
}
