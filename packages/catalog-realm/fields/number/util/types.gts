import type IconComponent from '@cardstack/boxel-icons/captions';

/**
 * Base configuration interface for number fields
 * Contains only the type discriminator - field-specific configs should define their own properties
 */
export interface NumberDisplayConfig {
  type?: string; // Field type for dynamic delegation (open to custom types)
}

/**
 * Common formatting options for numeric display
 */
export interface NumericFormattingConfig {
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

/**
 * Common range constraints for numeric input
 */
export interface NumericRangeConfig {
  min?: number;
  max?: number;
}

export interface SliderConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'slider'; // Required - ensures proper delegation
  min: number; // Required for slider
  max: number; // Required for slider
  showValue?: boolean;
}

export interface RatingConfig extends NumberDisplayConfig {
  type: 'rating'; // Required
  maxStars: number; // Only property needed - rating doesn't use decimals, prefix, suffix, min, max
}

export interface QuantityConfig
  extends NumberDisplayConfig,
    NumericRangeConfig {
  type: 'quantity'; // Required
  min: number; // Required
  max: number; // Required
}

/**
 * Consolidated Percentage Config - supports bar and circle visual styles
 * Consolidates functionality from old progress-bar and progress-circle types
 *
 * Components support @showValue arg (default: true) - set to false to show only shape without internal text
 *
 * Size control: Use CSS custom properties in scoped styles
 * - --progress-bar-height: Control bar height (e.g., '1rem', '12px')
 * - --progress-circle-size: Control circle diameter (e.g., '160px', '80px')
 * - --progress-circle-stroke-width: Control circle stroke (e.g., 4, 8, 12)
 * - --progress-circle-value-size: Control internal text size
 * - --progress-circle-max-size: Control max label text size
 */
export interface PercentageConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'percentage'; // Required
  min: number; // Required
  max: number; // Required
  visualStyle?: 'bar' | 'circle'; // Visual presentation style (default: 'bar')
  barStyle?: 'gradient' | 'solid'; // Bar appearance (for visualStyle: 'bar')
  label?: string; // Custom label text
  showRange?: boolean; // Show min-max range display
  valueFormat?: 'percentage' | 'fraction'; // "75%" vs "75 / 100"
}

export interface StatConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'stat'; // Required
  min: number; // Required
  max: number; // Required
  label?: string;
  subtitle?: string;
  icon?: typeof IconComponent;
}

export interface ScoreConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'score'; // Required
  min: number; // Required
  max: number; // Required
  label?: string; // Custom label (default: 'Score')
}

export interface GaugeConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'gauge'; // Required
  min: number; // Required
  max: number; // Required
  label?: string;
  showValue?: boolean;
  dangerThreshold?: number; // Value above which gauge shows danger color
  warningThreshold?: number; // Value above which gauge shows warning color
}

export interface BadgeNotificationConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'badge-notification'; // Required
  min: number; // Required
  max: number; // Required
  label?: string;
  icon?: typeof IconComponent;
}

export interface BadgeMetricConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'badge-metric'; // Required
  min: number; // Required
  max: number; // Required
  label?: string;
  icon?: typeof IconComponent;
}

export interface BadgeCounterConfig
  extends NumberDisplayConfig,
    NumericFormattingConfig,
    NumericRangeConfig {
  type: 'badge-counter'; // Required
  min: number; // Required
  max: number; // Required
  label?: string;
}
