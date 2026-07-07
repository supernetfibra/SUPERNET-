/**
 * CPF (Cadastro de Pessoas Físicas) validation and normalization utilities.
 */

/**
 * Remove all non-numeric characters from a CPF string.
 */
export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Format a CPF string as XXX.XXX.XXX-XX.
 */
export function formatCpf(cpf: string): string {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return cpf;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/**
 * Mask a CPF showing only first 3 and last 2 digits.
 * Returns "XXX.XXX.XXX-XX" format.
 */
export function maskCpf(cpf: string): string {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return cpf;
  return `***.${digits.slice(3, 6)}.***-${digits.slice(9)}`;
}

/**
 * Validate a CPF number (checks digits and verification algorithm).
 */
export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpf(cpf);
  
  if (digits.length !== 11) return false;
  
  // Reject known invalid sequences (all same digit)
  if (/^(\d)\1{10}$/.test(digits)) return false;
  
  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;
  
  // Validate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;
  
  return true;
}

/**
 * Mask a CPF partially showing only first digit and last two.
 * Used for display purposes.
 */
export function partialMaskCpf(cpf: string): string {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return cpf;
  return `${digits[0]}**.***.${digits.slice(6, 9)}-**${digits.slice(10)}`;
}
