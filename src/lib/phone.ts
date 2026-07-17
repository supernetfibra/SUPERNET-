/**
 * Phone number normalization and masking utilities.
 * Handles Brazilian phone numbers (DDD + number).
 */

/**
 * Remove all non-numeric characters from a phone string.
 */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Check if a phone number is valid (at least 10 digits).
 */
export function isValidPhone(phone: string): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= 10 && digits.length <= 11;
}

/**
 * Format phone as (XX) XXXXX-XXXX or (XX) XXXX-XXXX.
 */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return phone;
}

/**
 * Mask a phone number showing only first few and last 2 digits.
 */
export function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length < 10) return phone;
  
  const ddd = digits.slice(0, 2);
  const last = digits.slice(-2);
  
  if (digits.length === 11) {
    // (XX) XXXXX**-XX
    const first5 = digits.slice(2, 7);
    return `(${ddd}) ${first5}**-${last}`;
  }
  // (XX) XXXX**-XX
  const first4 = digits.slice(2, 6);
  return `(${ddd}) ${first4}**-${last}`;
}

/**
 * Compare two phone numbers after normalization.
 */
export function phonesMatch(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}
