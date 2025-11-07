import SliderField from '../slider';
import RatingField from '../rating';
import QuantityField from '../quantity';
import PercentageField from '../percentage';
import StatField from '../stat';
import BadgeNotificationField from '../badge-notification';
import BadgeMetricField from '../badge-metric';
import BadgeCounterField from '../badge-counter';
import ScoreField from '../score';
import ProgressBarField from '../progress-bar';
import ProgressCircleField from '../progress-circle';
import GaugeField from '../gauge';

import {
  DisplayConfig,
  SliderConfig,
  RatingConfig,
  QuantityConfig,
  PercentageConfig,
  StatConfig,
  BadgeNotificationConfig,
  BadgeMetricConfig,
  BadgeCounterConfig,
  ScoreConfig,
  ProgressBarConfig,
  ProgressCircleConfig,
  GaugeConfig,
} from './types';

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
  config: DisplayConfig = {},
): string {
  const { decimals = 0, prefix = '', suffix = '' } = config;

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

// Map each field type to its config type for clarity
export type FieldConfigMap = {
  slider: SliderConfig;
  rating: RatingConfig;
  quantity: QuantityConfig;
  percentage: PercentageConfig;
  stat: StatConfig;
  'badge-notification': BadgeNotificationConfig;
  'badge-metric': BadgeMetricConfig;
  'badge-counter': BadgeCounterConfig;
  score: ScoreConfig;
  'progress-bar': ProgressBarConfig;
  'progress-circle': ProgressCircleConfig;
  gauge: GaugeConfig;
};

// Map each field type to its class
const FIELD_TYPE_MAP: Record<keyof FieldConfigMap, any> = {
  slider: SliderField,
  rating: RatingField,
  quantity: QuantityField,
  percentage: PercentageField,
  stat: StatField,
  'badge-notification': BadgeNotificationField,
  'badge-metric': BadgeMetricField,
  'badge-counter': BadgeCounterField,
  score: ScoreField,
  'progress-bar': ProgressBarField,
  'progress-circle': ProgressCircleField,
  gauge: GaugeField,
};

export function getFieldClass(type?: keyof FieldConfigMap): any | null {
  if (!type) return null;
  return FIELD_TYPE_MAP[type] ?? null;
}
