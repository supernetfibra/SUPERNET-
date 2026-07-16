/**
 * Hook for copying text to clipboard with a fallback for older browsers.
 * Returns a [copiedId, handleCopy] tuple.
 */

import { useState } from "react";

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
    setTimeout(() => setCopiedId(null), duration);
  };

  return [copiedId, handleCopy] as const;
}
