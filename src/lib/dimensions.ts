export const MIN_DIMENSION = 1;
export const MAX_DIMENSION = 512;

export function clampDimension(value: number, fallback = MIN_DIMENSION): number {
  const safeFallback = Number.isFinite(fallback)
    ? Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, Math.round(fallback)))
    : MIN_DIMENSION;
  if (!Number.isFinite(value)) return safeFallback;
  return Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, Math.round(value)));
}

/**
 * Parse an in-progress dimension input without forcing an empty field to 1.
 * The caller keeps the last valid numeric value while the draft is incomplete.
 */
export function parseDimensionDraft(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < MIN_DIMENSION || number > MAX_DIMENSION) return null;
  return number;
}

export function normalizeDimensionDraft(raw: string, fallback: number): string {
  return String(parseDimensionDraft(raw) ?? clampDimension(fallback));
}
