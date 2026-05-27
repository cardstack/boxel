import { PRECISION } from './const.ts';

export function fuzzyNumbersEqual(
  actual: number,
  expected: number,
  fractionDigits: number = PRECISION,
): boolean {
  return fuzzyCompareNumbers(actual, expected, fractionDigits) === 0;
}

export function fuzzyCompareNumbers(
  actual: number,
  expected: number,
  fractionDigits: number = PRECISION,
): number {
  if (actual.toFixed(fractionDigits) === expected.toFixed(fractionDigits)) {
    return 0;
  } else {
    return actual > expected ? 1 : -1;
  }
}
