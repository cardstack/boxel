import {
  DEFAULT_RGBA,
  parseBrowserColor,
  parseHslFormat,
  parseHsbFormat,
  parseHexFormat,
} from './css-color-parsers';
import { rgbaToHexString } from '@cardstack/boxel-ui/helpers';
import type { RGBA, RichColorFormat } from '@cardstack/boxel-ui/helpers';

export type AdvancedColorFormat = RichColorFormat;
export type SliderColorFormat = 'rgb' | 'hsl';
export type WheelColorFormat = 'hex' | 'rgb' | 'hsl';
export type ColorFormat = AdvancedColorFormat;

export type ColorVariant =
  | 'standard'
  | 'swatches-picker'
  | 'slider'
  | 'advanced'
  | 'wheel';

export interface ColorFieldBaseOptions {
  /**
   * Used by the UX add-ons: the recent color grid and WCAG contrast checker.
   */
  showRecent?: boolean;
  showContrastChecker?: boolean;
  /**
   * Maximum number of recent colors to display in the history.
   * Defaults to 8 if not specified.
   */
  maxRecentHistory?: number;
  /**
   * Color to check contrast against when showContrastChecker is true.
   * Used to determine if the selected color (foreground or background) meets WCAG contrast requirements.
   * Defaults to '#ffffff' (white) if not specified.
   *
   * For dynamic contrast checking based on another field, use a configuration function:
   *
   * @example
   * // Static color
   * configuration: {
   *   options: {
   *     showContrastChecker: true,
   *     contrastColor: '#000000'
   *   }
   * }
   *
   * @example
   * // Dynamic color from another field (using configuration function)
   * configuration: function (this: MyCard) {
   *   return {
   *     options: {
   *       showContrastChecker: true,
   *       contrastColor: this.footerBgColor ?? '#f9fafb'
   *     }
   *   };
   * }
   */
  contrastColor?: string;
}

export interface ColorFieldPaletteOptions {
  paletteColors?: string[];
}

export type AdvancedVariantConfiguration = {
  variant: 'advanced';
  options?: { defaultFormat?: AdvancedColorFormat };
};

export type WheelVariantConfiguration = {
  variant: 'wheel';
  options?: ColorFieldBaseOptions & { defaultFormat?: WheelColorFormat };
};

type PaletteVariantConfiguration = {
  variant: 'swatches-picker';
  options?: ColorFieldBaseOptions & ColorFieldPaletteOptions;
};

export type SliderVariantConfiguration = {
  variant: 'slider';
  options?: ColorFieldBaseOptions & { defaultFormat?: SliderColorFormat };
};

type StandardVariantConfiguration = {
  variant?: 'standard';
  options?: ColorFieldBaseOptions;
};

export type ColorFieldConfiguration =
  | StandardVariantConfiguration
  | PaletteVariantConfiguration
  | SliderVariantConfiguration
  | AdvancedVariantConfiguration
  | WheelVariantConfiguration;

// ========== Simple LRU Cache for Performance ==========
class ColorCache {
  private cache = new Map<string, { rgba: RGBA; valid: boolean }>();
  private readonly maxSize = 100;

  private key(color: string): string {
    return color.trim();
  }

  get(color: string): { rgba: RGBA; valid: boolean } | undefined {
    const k = this.key(color);
    const value = this.cache.get(k);
    if (value) {
      // true LRU: refresh recency
      this.cache.delete(k);
      this.cache.set(k, value);
    }
    return value;
  }

  set(color: string, result: { rgba: RGBA; valid: boolean }): void {
    const k = this.key(color);

    // If it already exists, delete first so insertion refreshes order
    if (this.cache.has(k)) {
      this.cache.delete(k);
    } else if (this.cache.size >= this.maxSize) {
      // evict least-recently-used (first in Map)
      const firstKey = this.cache.keys().next().value as string | undefined;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(k, result);
  }

  clear(): void {
    this.cache.clear();
  }
}

const colorCache = new ColorCache();

// ========== Public API ==========

/**
 * Parse any CSS color format to RGBA with validation.
 * Uses caching for performance during frequent operations (like dragging).
 *
 * Parsing priority:
 * 1. Cache lookup (for performance)
 * 2. HSL/HSB formats (for round-trip accuracy)
 * 3. Hex format (fastest, most common)
 * 4. Browser parsing (named colors, rgb, modern CSS)
 * 5. Canvas fallback (most reliable for CSS Color Level 4)
 */
export function parseCssColorSafe(color: string | null | undefined): {
  rgba: RGBA;
  valid: boolean;
} {
  if (!color) {
    return { rgba: DEFAULT_RGBA, valid: false };
  }

  const trimmed = color.trim();
  if (trimmed === '') {
    return { rgba: DEFAULT_RGBA, valid: false };
  }

  const cached = colorCache.get(trimmed);
  if (cached) {
    return cached;
  }

  // 1. Try HSL format (round-trip accuracy)
  const hslRgba = parseHslFormat(trimmed);
  if (hslRgba) {
    const result = { rgba: hslRgba, valid: true };
    colorCache.set(trimmed, result);
    return result;
  }

  // 2. Try HSB format
  const hsbRgba = parseHsbFormat(trimmed);
  if (hsbRgba) {
    const result = { rgba: hsbRgba, valid: true };
    colorCache.set(trimmed, result);
    return result;
  }

  // 3. Try hex format (fast path)
  const hexRgba = parseHexFormat(trimmed);
  if (hexRgba) {
    const result = { rgba: hexRgba, valid: true };
    colorCache.set(trimmed, result);
    return result;
  }

  // 4. Browser parsing (named colors, rgb(), modern CSS)
  const browserResult = parseBrowserColor(trimmed);
  colorCache.set(trimmed, browserResult);
  return browserResult;
}

/**
 * Parse any CSS color format to RGBA (throws no errors, always returns valid RGBA).
 * Uses DEFAULT_RGBA as fallback for invalid colors.
 */
export function parseCssColor(color: string | null | undefined): RGBA {
  return parseCssColorSafe(color).rgba;
}

/**
 * Normalize any color format to uppercase hex string for history/comparison.
 * Returns null if color is invalid.
 */
export function normalizeColorForHistory(
  color: string | null | undefined,
): string | null {
  const { rgba, valid } = parseCssColorSafe(color);
  if (!valid) {
    return null;
  }

  return rgbaToHexString(rgba).toUpperCase();
}
