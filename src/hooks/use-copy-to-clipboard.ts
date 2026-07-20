/**
 * Hook for copying text to clipboard with a fallback for older browsers.
 * Shows a Sonner toast notification on successful copy.
 * Returns a [copiedId, handleCopy] tuple.
 */

import { useState } from "react";
import { toast } from "sonner";

export function useCopyToClipboard(duration = 2000) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedId(id);
    toast.success("Código copiado!", {
      duration: 2000,
      position: "bottom-center",
    });
    setTimeout(() => setCopiedId(null), duration);
  };

  return [copiedId, handleCopy] as const;
}
