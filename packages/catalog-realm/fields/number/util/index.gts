// Types are now defined in component files
export interface NumberFormattingOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

export function hasValue(model: any): boolean {
  return model != null;
}

/**
 * Get numeric value from model, with fallback to 0
 */
export function getNumericValue(model: any): number {
  const value = model ?? 0;
  return typeof value === 'number' ? value : parseFloat(value) || 0;
}

/**
 * Get formatted display value for all view formats (edit/embedded/atom)
 * This shared function handles prefix/suffix formatting consistently across all views
 *
 * @param model - The number model value (defaults to 0 if null/undefined)
 * @param options - Formatting options (decimals, prefix, suffix)
 * @returns Formatted display string with prefix/suffix applied
 *
 * @example
 * getFormattedDisplayValue(75, { prefix: '$', decimals: 2 }) // "$75.00"
 * getFormattedDisplayValue(85, { suffix: '%', decimals: 0 }) // "85%"
 * getFormattedDisplayValue(42, { prefix: '$', suffix: ' USD', decimals: 2 }) // "$42.00 USD"
 * getFormattedDisplayValue(null, { prefix: '$', decimals: 2 }) // "$0.00"
 */
export function getFormattedDisplayValue(
  model: any,
  options: NumberFormattingOptions = {},
): string {
  // Only use allowed keys from options
  const { decimals = 0, prefix = '', suffix = '' } = options || {};
  const numericValue = getNumericValue(model);
  const formattedValue = numericValue.toFixed(decimals);
  return `${prefix}${formattedValue}${suffix}`;
}

/**
 * Calculate percentage within a range
 */
export function calculatePercentage(
  value: number,
  min: number,
  max: number,
): number {
  const range = max - min;
  const position = value - min;
  return Math.min(100, Math.max(0, (position / range) * 100));
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
