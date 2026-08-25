/**
 * Installation request helper — submits a new-customer request from the
 * landing page to the public endpoint POST /api/public/install-request.
 */

export interface InstallRequestPayload {
  fullName: string;
  cpf: string;
  phone: string;
  email?: string;
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  desiredPlan?: string;
  message?: string;
  agreedToTerms: boolean;
  // Honeypot field — bots fill it, real users never see it. Keep it out of
  // the payload construction so it is only ever sent when a bot fills it.
  website?: string;
}

export interface InstallRequestResult {
  ok: boolean;
  error?: string;
}

export async function submitInstallRequest(
  payload: InstallRequestPayload
): Promise<InstallRequestResult> {
  try {
    const res = await fetch("/api/public/install-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.error || "Não foi possível enviar a solicitação. Tente novamente.",
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Falha de conexão. Verifique sua internet e tente novamente.",
    };
  }
}
