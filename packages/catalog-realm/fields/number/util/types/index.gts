import type IconComponent from '@cardstack/boxel-icons/captions';

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
  | 'progress-circle'
  | 'gauge';

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

export interface SliderConfig extends DisplayConfig {
  type: 'slider'; // Required - ensures proper delegation
  min: number;
  max: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  showValue?: boolean;
}

export interface RatingConfig extends DisplayConfig {
  type: 'rating'; // Required
  maxStars: number;
}

export interface QuantityConfig extends DisplayConfig {
  type: 'quantity'; // Required
  min: number;
  max: number;
}

export interface PercentageConfig extends DisplayConfig {
  type: 'percentage'; // Required
  decimals?: number;
  min: number;
  max: number;
}

export interface StatConfig extends DisplayConfig {
  type: 'stat'; // Required
  prefix?: string;
  suffix?: string;
  decimals?: number;
  min: number;
  max: number;
  label?: string;
  placeholder?: string;
  subtitle?: string;
  icon?: typeof IconComponent;
}

export interface BadgeConfig extends DisplayConfig {
  type: 'badge'; // Required
  decimals?: number;
  min: number;
  max: number;
  label?: string;
  placeholder?: string;
  icon?: typeof IconComponent;
}

export interface ScoresConfig extends DisplayConfig {
  type: 'scores'; // Required
  decimals?: number;
  min: number;
  max: number;
}

export interface ProgressBarConfig extends DisplayConfig {
  type: 'progress-bar'; // Required
  min: number;
  max: number;
  label?: string;
}

export interface ProgressCircleConfig extends DisplayConfig {
  type: 'progress-circle'; // Required
  min: number;
  max: number;
}

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
