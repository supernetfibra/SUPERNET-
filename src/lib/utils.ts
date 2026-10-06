import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * FASE 6 / item 10 — comportamento de rolagem que respeita
 * `prefers-reduced-motion`. Quem pede menos movimento recebe salto seco;
 * quem não pede mantém a rolagem suave de antes.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
