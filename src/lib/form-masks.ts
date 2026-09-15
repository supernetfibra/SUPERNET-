/**
 * Input Mask Utilities — Format inputs in real-time as the user types.
 *
 * All functions return the formatted value AND the cursor position,
 * so caret placement stays correct after inserting dots/dashes.
 */

/** Format CPF digits: 000.000.000-00 */
export function maskCpf(value: string): { value: string; cursor: number } {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  const len = digits.length;

  if (len <= 3) return { value: digits, cursor: len };
  if (len <= 6) return { value: `${digits.slice(0, 3)}.${digits.slice(3)}`, cursor: len + 1 };
  if (len <= 9) return { value: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`, cursor: len + 2 };
  return {
    value: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`,
    cursor: len + 3,
  };
}

/** Format phone: (00) 00000-0000 or (00) 0000-0000 */
export function maskPhone(value: string): { value: string; cursor: number } {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  const len = digits.length;

  if (len <= 2) return { value: digits, cursor: len };
  if (len <= 6) return { value: `(${digits.slice(0, 2)}) ${digits.slice(2)}`, cursor: len + 3 };
  if (len <= 10) return { value: `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`, cursor: len + 4 };
  return { value: `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`, cursor: len + 4 };
}

/** Format CEP: 00000-000 */
export function maskCep(value: string): { value: string; cursor: number } {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const len = digits.length;

  if (len <= 5) return { value: digits, cursor: len };
  return { value: `${digits.slice(0, 5)}-${digits.slice(5)}`, cursor: len + 1 };
}

/**
 * Generic onChange handler for masked inputs.
 * Usage: <input onChange={handleMask(maskCpf)} />
 *
 * Preserves cursor position after mask insertion.
 */
export function createMaskHandler(
  maskFn: (v: string) => { value: string; cursor: number },
  setter: (v: string) => void,
): (e: React.ChangeEvent<HTMLInputElement>) => void {
  return (e) => {
    const input = e.target;
    const prevLen = input.value.length;
    const { value, cursor } = maskFn(input.value);
    setter(value);

    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      if (input.selectionStart !== null) {
        // Adjust cursor: if text grew, move cursor forward; if shrank, keep it
        const delta = value.length - prevLen;
        const newCursor = input.selectionStart + delta;
        input.setSelectionRange(newCursor, newCursor);
      }
    });
  };
}
