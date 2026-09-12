export function parseNumericValue(rawNumber: number, rawString: string, integer: boolean): number {
  const parsed = Number.isFinite(rawNumber) ? rawNumber : rawString.trim() ? Number(rawString) : Number.NaN;
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(integer ? 'Enter a valid integer number.' : 'Enter a valid finite number.');
  }
  return parsed;
}
