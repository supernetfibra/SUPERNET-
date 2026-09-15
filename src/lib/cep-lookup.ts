/**
 * CEP Lookup — Auto-fill address fields from Brazilian ZIP code via ViaCEP API.
 *
 * ViaCEP is a free public API: https://viacep.com.br/
 * No API key needed. Returns structured address data for valid CEPs.
 */

export interface CepResult {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
}

/**
 * Look up a CEP (Brazilian ZIP code) and return structured address data.
 * Returns null if the CEP is invalid or the API is unreachable.
 */
export async function lookupCep(cep: string): Promise<CepResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!response.ok) return null;

    const data = await response.json();

    // ViaCEP returns { erro: true } for invalid CEPs
    if (data.erro) return null;

    return {
      street: data.logradouro || "",
      neighborhood: data.bairro || "",
      city: data.localidade || "",
      state: data.uf || "",
      complement: data.complemento || undefined,
    };
  } catch {
    // Network error or CORS issue — silently fail
    return null;
  }
}
