import { KNOWN_PARAMETER_CATEGORIES, type ConnectorValueType } from '../types/api';

export function parseNumericValue(rawNumber: number, rawString: string, integer: boolean): number {
  const parsed = Number.isFinite(rawNumber) ? rawNumber : rawString.trim() ? Number(rawString) : Number.NaN;
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(integer ? 'Enter a valid integer number.' : 'Enter a valid finite number.');
  }
  return parsed;
}

export function isScalar(val: unknown): boolean {
  return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean';
}

export function areAllowedValuesScalar(allowed: unknown[] | null | undefined): boolean {
  return Array.isArray(allowed) && allowed.length > 0 && allowed.every(isScalar);
}

export function valuesMatch(left: unknown, right: unknown): boolean {
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

export function parseTypedValue(raw: string, type: ConnectorValueType): unknown {
  const trimmed = raw.trim();
  if (type === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    throw new Error('Choose true or false for boolean values.');
  }
  if (type === 'integer') {
    if (!/^-?\d+$/.test(trimmed)) throw new Error(`"${raw}" is not a valid integer.`);
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num)) throw new Error(`"${raw}" is not a safe integer.`);
    return num;
  }
  if (type === 'number') {
    if (!trimmed || !Number.isFinite(Number(trimmed))) throw new Error(`"${raw}" is not a valid number.`);
    return Number(trimmed);
  }
  if (type === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`"${raw}" is not valid JSON.`);
    }
  }
  if (type === 'secret_ref') {
    if (!/^env:\/\/[A-Z][A-Z0-9_]{0,127}$/.test(trimmed)) {
      throw new Error('Secret reference must follow the format env://VARIABLE_NAME.');
    }
    return trimmed;
  }
  return raw;
}

export function validateAllowedValue(value: unknown, allowedValues: unknown[] | null | undefined): boolean {
  if (!allowedValues || allowedValues.length === 0) return true;
  return allowedValues.some(item => valuesMatch(item, value));
}

export function validateTaxonomy(category: string, subcategory?: string | null): boolean {
  if (!(category in KNOWN_PARAMETER_CATEGORIES)) return false;
  if (!subcategory) return true;
  return Boolean(String(subcategory).trim());
}
