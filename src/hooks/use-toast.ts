/**
 * Toast hook — wraps sonner's toast for convenience.
 */

import { toast } from "sonner";

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
  duration?: number;
}

export function useToast() {
  return {
    toast: (options: ToastOptions) => {
      const { title, description, variant, duration } = options;
      if (variant === "destructive") {
        toast.error(title || "Erro", {
          description,
          duration,
        });
      } else if (variant === "success") {
        toast.success(title || "Sucesso", {
          description,
          duration,
        });
      } else {
        toast(title || "", {
          description,
          duration,
        });
      }
    },
    dismiss: (id?: string) => toast.dismiss(id),
  };
}
