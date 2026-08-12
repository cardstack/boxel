import { EXCEL_ERROR, throwExcelError } from './errors.js';

export function isDefined(value: unknown) {
  return value !== undefined && value !== null;
}

export function isExcelBlank(value: unknown) {
  return value === undefined || value === null || value === '';
}

export function flattenExcelArgs(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [value];
  }

  const output: unknown[] = [];
  for (const entry of value) {
    output.push(...flattenExcelArgs(entry));
  }
  return output;
}

export function parseExcelNumber(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
    return parseFloat(value);
  }

  throwExcelError(EXCEL_ERROR.value);
}

export function parseExcelString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

export function parseExcelBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper === 'TRUE') {
      return true;
    }
    if (upper === 'FALSE') {
      return false;
    }
  }

  throwExcelError(EXCEL_ERROR.value);
}

export function parseExcelArray(value: unknown): unknown[] {
  return flattenExcelArgs(value);
}

export function parseExcelNumberArray(value: unknown): number[] {
  const entries = flattenExcelArgs(value);
  if (entries.length === 0) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return entries.map((entry) => parseExcelNumber(entry));
}

export function sumExcelRange(value: unknown) {
  let result = 0;

  for (const entry of flattenExcelArgs(value)) {
    if (typeof entry === 'number') {
      result += entry;
      continue;
    }
    if (typeof entry === 'string') {
      const parsed = parseFloat(entry);
      if (!Number.isNaN(parsed)) {
        result += parsed;
      }
      continue;
    }
    if (Array.isArray(entry)) {
      result += sumExcelRange(entry);
    }
  }

  return result;
}

export function countExcelNumbers(value: unknown) {
  return flattenExcelArgs(value).filter(
    (entry) => typeof entry === 'number' && Number.isFinite(entry),
  ).length;
}

export function countExcelValues(value: unknown) {
  return flattenExcelArgs(value).filter(
    (entry) => entry !== undefined && entry !== null && entry !== '',
  ).length;
}

export function averageExcelRange(value: unknown) {
  const flat = flattenExcelArgs(value).filter(isDefined);
  if (flat.length === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }

  const numbers = flat.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );

  if (numbers.length === 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
}

export function minExcelRange(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  return Math.min(...numbers);
}

export function maxExcelRange(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  return Math.max(...numbers);
}

export function sampleStdDev(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  if (numbers.length < 2) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const mean = numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
  const variance =
    numbers.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) /
    (numbers.length - 1);
  return Math.sqrt(variance);
}

export function populationStdDev(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  if (numbers.length === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const mean = numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
  const variance =
    numbers.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) /
    numbers.length;
  return Math.sqrt(variance);
}
