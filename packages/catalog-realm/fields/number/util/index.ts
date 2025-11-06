/**
 * Shared utilities for number field components
 * 
 * This module provides reusable helpers to reduce duplication across
 * all number field types (basic, slider, rating, percentage, etc.)
 */



/**
 * Check if a model has a value (not null/undefined)
 */
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
 * Field type registry for dynamic delegation
 */
export type FieldType = 
  | 'slider' 
  | 'rating' 
  | 'quantity'
  | 'percentage'
  | 'stat'
  | 'badge'
  | 'scores'
  | 'progress-bar'
  | 'progress-circle';

/**
 * Common display configuration for number fields
 */
export interface DisplayConfig {
  type?: FieldType; // Field type for dynamic delegation
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}

/**
 * Slider field configuration
 */
export interface SliderConfig extends DisplayConfig {
  type?: 'slider';
  min: number;
  max: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  showValue?: boolean;
}

/**
 * Rating field configuration
 */
export interface RatingConfig extends DisplayConfig {
  type?: 'rating';
  maxStars: number;
}

/**
 * Quantity field configuration
 */
export interface QuantityConfig extends DisplayConfig {
  type?: 'quantity';
  min: number;
  max: number;
}

/**
 * Percentage field configuration
 */
export interface PercentageConfig extends DisplayConfig {
  type?: 'percentage';
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Stat field configuration
 */
export interface StatConfig extends DisplayConfig {
  type?: 'stat';
  prefix?: string;
  suffix?: string;
  decimals?: number;
  min: number;
  max: number;
  label?: string;
}

/**
 * Badge field configuration
 */
export interface BadgeConfig extends DisplayConfig {
  type?: 'badge';
  label?: string;
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Scores field configuration
 */
export interface ScoresConfig extends DisplayConfig {
  type?: 'scores';
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Progress Bar field configuration
 */
export interface ProgressBarConfig extends DisplayConfig {
  type?: 'progress-bar';
  min: number;
  max: number;
  label?: string;
}

/**
 * Progress Circle field configuration
 */
export interface ProgressCircleConfig extends DisplayConfig {
  type?: 'progress-circle';
  min: number;
  max: number;
}

/**
 * Get formatted display value for all view formats (edit/embedded/atom)
 * This shared function handles prefix/suffix formatting consistently across all views
 * 
 * @param model - The number model value (defaults to 0 if null/undefined)
 * @param config - Display configuration (decimals, prefix, suffix)
 * @returns Formatted display string with prefix/suffix applied
 * 
 * @example
 * // With prefix
 * getFormattedDisplayValue(75, { prefix: '$', decimals: 2 })
 * // Returns: "$75.00"
 * 
 * // With suffix
 * getFormattedDisplayValue(85, { suffix: '%', decimals: 0 })
 * // Returns: "85%"
 * 
 * // With both prefix and suffix
 * getFormattedDisplayValue(42, { prefix: '$', suffix: ' USD', decimals: 2 })
 * // Returns: "$42.00 USD"
 * 
 * // Null/undefined handling (defaults to 0)
 * getFormattedDisplayValue(null, { prefix: '$', decimals: 2 })
 * // Returns: "$0.00"
 */
export function getFormattedDisplayValue(
  model: any,
  config: DisplayConfig = {}
): string {
  const {
    decimals = 0,
    prefix = '',
    suffix = '',
  } = config;

  // Always default to 0 for empty values
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
  max: number
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

/**
 * Format number with prefix and suffix
 */
export function formatWithAffixes(
  value: string | number,
  prefix: string = '',
  suffix: string = ''
): string {
  return `${prefix}${value}${suffix}`;
}

/**
 * Parse string input to number, handling empty and negative sign
 */
export function parseNumberInput(input: string): number | null {
  if (input === '' || input === '-') {
    return null;
  }
  const num = parseFloat(input);
  return isNaN(num) ? null : num;
}

/**
 * Registry map for field type components
 * This allows dynamic delegation based on config.type
 */
export const FIELD_TYPE_REGISTRY = new Map<FieldType, any>();

/**
 * Register a field type with its component class
 */
export function registerFieldType(type: FieldType, componentClass: any): void {
  FIELD_TYPE_REGISTRY.set(type, componentClass);
}

/**
 * Get the specialized field class for a given type
 */
export function getFieldClass(type: FieldType | undefined): any | null {
  if (!type) return null;
  return FIELD_TYPE_REGISTRY.get(type) ?? null;
}
