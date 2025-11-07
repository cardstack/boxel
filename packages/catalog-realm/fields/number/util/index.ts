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
 * Core field types provided by the catalog-realm
 * These are the built-in field types that ship with Boxel
 */
export type CoreFieldType = 
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
 * Field type registry for dynamic delegation
 * 
 * This type is intentionally open to allow users to register custom field types.
 * Users can extend this by creating their own field types and registering them
 * with `registerFieldType()`.
 * 
 * The `(string & {})` trick allows any string while still providing autocomplete
 * for CoreFieldType values in IDEs that support it.
 * 
 * @example
 * // In your custom field:
 * registerFieldType('currency', CurrencyField);
 * 
 * // Then use it:
 * @field price = contains(NumberField, {
 *   presentation: { type: 'currency', currency: 'USD' }
 * });
 */
export type FieldType = CoreFieldType | (string & {});

/**
 * Common display configuration for number fields
 * 
 * This interface provides the base properties shared by all number field configurations.
 * Custom field types should extend this interface to add their own type-safe properties,
 * NOT use the `[key: string]: any` pattern, which would compromise type safety.
 * 
 * @example
 * // CORRECT - Create a strongly-typed config interface:
 * export interface CurrencyConfig extends DisplayConfig {
 *   currency: 'USD' | 'EUR' | 'GBP';
 *   locale?: string;
 * }
 * 
 * // This maintains full type safety for your custom properties
 */
export interface DisplayConfig {
  type?: string; // Field type for dynamic delegation (open to custom types)
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}

/**
 * Slider field configuration
 * 
 * @property type - Field type identifier (required for NumberField delegation)
 * @property min - Minimum value (required)
 * @property max - Maximum value (required)
 * @property showValue - Whether to display the current value next to the slider
 * 
 * @example
 * // Using with NumberField:
 * @field volume = contains(NumberField, {
 *   presentation: { type: 'slider', min: 0, max: 100 }
 * });
 */
export interface SliderConfig extends DisplayConfig {
  type: 'slider'; // Required - ensures proper delegation
  min: number;
  max: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  showValue?: boolean;
}

/**
 * Rating field configuration
 * 
 * @property type - Field type identifier (required for NumberField delegation)
 * @property maxStars - Maximum number of stars (required)
 * 
 * @example
 * // Using with NumberField:
 * @field rating = contains(NumberField, {
 *   presentation: { type: 'rating', maxStars: 5 }
 * });
 */
export interface RatingConfig extends DisplayConfig {
  type: 'rating'; // Required
  maxStars: number;
}

/**
 * Quantity field configuration
 */
export interface QuantityConfig extends DisplayConfig {
  type: 'quantity'; // Required
  min: number;
  max: number;
}

/**
 * Percentage field configuration
 */
export interface PercentageConfig extends DisplayConfig {
  type: 'percentage'; // Required
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Stat field configuration
 */
export interface StatConfig extends DisplayConfig {
  type: 'stat'; // Required
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
  type: 'badge'; // Required
  label?: string;
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Scores field configuration
 */
export interface ScoresConfig extends DisplayConfig {
  type: 'scores'; // Required
  decimals?: number;
  min: number;
  max: number;
}

/**
 * Progress Bar field configuration
 */
export interface ProgressBarConfig extends DisplayConfig {
  type: 'progress-bar'; // Required
  min: number;
  max: number;
  label?: string;
}

/**
 * Progress Circle field configuration
 */
export interface ProgressCircleConfig extends DisplayConfig {
  type: 'progress-circle'; // Required
  min: number;
  max: number;
}

/**
 * Gauge field configuration
 */
export interface GaugeConfig extends DisplayConfig {
 type: 'gauge';
  min: number;
  max: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  label?: string;
  showValue?: boolean;
  dangerThreshold?: number; // Value above which gauge shows danger color
  warningThreshold?: number; // Value above which gauge shows warning color
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
 * Registry map for field type components
 * 
 * This allows dynamic delegation based on config.type. The registry accepts
 * any string as a key, allowing users to register custom field types without
 * modifying the source code.
 * 
 * @example
 * // Register a custom field type:
 * import { registerFieldType } from '@cardstack/catalog-realm/fields/number/util';
 * registerFieldType('temperature', TemperatureField);
 */
export const FIELD_TYPE_REGISTRY = new Map<string, any>();

/**
 * Register a field type with its component class
 * 
 * Use this function to register both built-in and custom field types.
 * Once registered, the field type can be used via the `type` configuration.
 * 
 * @param type - The unique identifier for this field type (e.g., 'slider', 'currency')
 * @param componentClass - The component class that implements this field type
 * 
 * @example
 * // Register a custom currency field:
 * registerFieldType('currency', CurrencyField);
 * 
 * // Then use it in your cards:
 * @field price = contains(NumberField, {
 *   presentation: { type: 'currency', currency: 'USD' }
 * });
 */
export function registerFieldType(type: string, componentClass: any): void {
  FIELD_TYPE_REGISTRY.set(type, componentClass);
}

/**
 * Get the specialized field class for a given type
 * 
 * This function is used internally by NumberField to delegate to the appropriate
 * specialized field implementation based on the configuration.
 * 
 * @param type - The field type identifier
 * @returns The component class for that type, or null if not registered
 */
export function getFieldClass(type: string | undefined): any | null {
  if (!type) return null;
  return FIELD_TYPE_REGISTRY.get(type) ?? null;
}
