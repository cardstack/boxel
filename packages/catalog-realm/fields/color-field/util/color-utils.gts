import { parseCssColorWithBrowser } from './parse-css-color';

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsb' | 'css';
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
  maxHistory?: number;
  storageKey?: string;
}

export interface ColorFieldAdvancedOptions {
  format?: ColorFormat;
  allowedFormats?: ColorFormat[];
}

export interface ColorFieldPaletteOptions {
  paletteColors?: string[];
}

export interface ColorFieldSliderOptions {
  sliderMode?: 'rgb' | 'hsl' | 'hsb' | 'all';
}

type AdvancedVariantConfiguration = {
  variant: 'advanced';
  options?: ColorFieldBaseOptions & ColorFieldAdvancedOptions;
};

type WheelVariantConfiguration = {
  variant: 'wheel';
  options?: ColorFieldBaseOptions & ColorFieldAdvancedOptions;
};

type PaletteVariantConfiguration = {
  variant: 'swatches-picker';
  options?: ColorFieldBaseOptions & ColorFieldPaletteOptions;
};

type SliderVariantConfiguration = {
  variant: 'slider';
  options?: ColorFieldBaseOptions & ColorFieldSliderOptions;
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

export type RGBA = { r: number; g: number; b: number; a: number };

// Use canvas to normalize any CSS color string into RGBA (supports modern CSS Color Level 4 values)
export function cssColorToRgbaViaCanvas(color: string): {
  rgba: RGBA;
  valid: boolean;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  // Clear and set; if the browser supports the color it will normalize internally
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#010101'; // sentinel so we can detect rejection

  try {
    ctx.fillStyle = color;
  } catch {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  // If canvas rejected the value it will not change fillStyle
  if (ctx.fillStyle === '#010101') {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;

  return {
    rgba: {
      r: data[0],
      g: data[1],
      b: data[2],
      a: parseFloat((data[3] / 255).toFixed(2)),
    },
    valid: true,
  };
}

export function cssColorToRgbaViaComputedStyle(color: string): {
  rgba: RGBA;
  valid: boolean;
} {
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      if (!CSS.supports('color', color)) {
        return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
      }
    }

    const temp = document.createElement('div');
    temp.style.color = '';
    temp.style.color = color;
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);

    const rgbaMatch = computed.match(
      /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
    );
    if (rgbaMatch) {
      return {
        rgba: {
          r: parseInt(rgbaMatch[1], 10),
          g: parseInt(rgbaMatch[2], 10),
          b: parseInt(rgbaMatch[3], 10),
          a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
        },
        valid: true,
      };
    }

    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  } catch {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }
}

// Parse any CSS color format to RGBA using browser's built-in parser
export function parseCssColor(color: string | null | undefined): RGBA {
  if (!color) return { r: 59, g: 130, b: 246, a: 1 }; // default blue

  const trimmed = color.trim();

  const browserParsed = parseCssColorWithBrowser(trimmed);
  if (browserParsed.valid) {
    return browserParsed.rgba;
  }

  const computedParsed = cssColorToRgbaViaComputedStyle(trimmed);
  if (computedParsed.valid) {
    return computedParsed.rgba;
  }

  const canvasParsed = cssColorToRgbaViaCanvas(trimmed);
  if (canvasParsed.valid) {
    return canvasParsed.rgba;
  }

  // Try parsing HSB format first: hsb(h, s%, b%)
  const hsbMatch = trimmed.match(
    /^hsb\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i,
  );
  if (hsbMatch) {
    const h = parseInt(hsbMatch[1], 10);
    const s = parseInt(hsbMatch[2], 10);
    const b = parseInt(hsbMatch[3], 10);
    const rgb = hsvToRgb(h, s, b);
    return { ...rgb, a: 1 };
  }

  // Use a temporary element to parse CSS color (handles color names, hex, rgb, hsl, etc.)
  const temp = document.createElement('div');
  temp.style.color = trimmed;
  document.body.appendChild(temp);
  const computed = window.getComputedStyle(temp).color;
  document.body.removeChild(temp);

  // Check if color was valid (invalid colors return empty string or unchanged)
  if (!computed || computed === '' || computed === trimmed) {
    // Fallback to hex parsing for edge cases
    return hexToRgba(trimmed);
  }

  // Parse rgba(r, g, b, a) or rgb(r, g, b)
  const rgbaMatch = computed.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Fallback to hex parsing
  return hexToRgba(trimmed);
}

export function parseCssColorSafe(color: string | null | undefined): {
  rgba: RGBA;
  valid: boolean;
} {
  if (!color) {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  const trimmed = color.trim();

  const browserParsed = parseCssColorWithBrowser(trimmed);
  if (browserParsed.valid) {
    return browserParsed;
  }

  const computedParsed = cssColorToRgbaViaComputedStyle(trimmed);
  if (computedParsed.valid) {
    return computedParsed;
  }

  const canvasParsed = cssColorToRgbaViaCanvas(trimmed);
  if (canvasParsed.valid) {
    return canvasParsed;
  }

  const hsbMatch = trimmed.match(
    /^hsb\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i,
  );
  if (hsbMatch) {
    const h = parseInt(hsbMatch[1], 10);
    const s = parseInt(hsbMatch[2], 10);
    const b = parseInt(hsbMatch[3], 10);
    const rgb = hsvToRgb(h, s, b);
    return { rgba: { ...rgb, a: 1 }, valid: true };
  }

  const temp = document.createElement('div');
  temp.style.color = '';
  temp.style.color = trimmed;
  document.body.appendChild(temp);
  const computed = window.getComputedStyle(temp).color;
  document.body.removeChild(temp);

  const rgbaMatch = computed.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
  );
  if (rgbaMatch) {
    return {
      rgba: {
        r: parseInt(rgbaMatch[1], 10),
        g: parseInt(rgbaMatch[2], 10),
        b: parseInt(rgbaMatch[3], 10),
        a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
      },
      valid: true,
    };
  }

  if (/^#?[a-f\d]{3}([a-f\d]{3})?([a-f\d]{2})?$/i.test(trimmed)) {
    return { rgba: hexToRgba(trimmed), valid: true };
  }

  return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
}

export function detectColorFormat(input: string): ColorFormat {
  const trimmed = input.trim();
  if (/^#?[a-f\d]{3}([a-f\d]{3})?([a-f\d]{2})?$/i.test(trimmed)) {
    return 'hex';
  }
  if (/^rgba?\(/i.test(trimmed)) {
    return 'rgb';
  }
  if (/^hsla?\(/i.test(trimmed)) {
    return 'hsl';
  }
  if (/^hsb\(/i.test(trimmed)) {
    return 'hsb';
  }
  return 'css';
}

export function hexToRgba(hex: string): RGBA {
  // Handle hex with alpha: #RRGGBBAA or #RGBA
  const hexWithAlpha =
    /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (hexWithAlpha) {
    return {
      r: parseInt(hexWithAlpha[1], 16),
      g: parseInt(hexWithAlpha[2], 16),
      b: parseInt(hexWithAlpha[3], 16),
      a: parseInt(hexWithAlpha[4], 16) / 255,
    };
  }

  // Handle 3-digit hex: #RGB
  const shortHex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
  if (shortHex) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16),
      a: 1,
    };
  }

  // Handle 6-digit hex: #RRGGBB
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
        a: 1,
      }
    : { r: 0, g: 0, b: 0, a: 1 };
}

export function rgbaToHex(rgba: RGBA, includeAlpha = false): string {
  const hex =
    '#' +
    [rgba.r, rgba.g, rgba.b]
      .map((x) => {
        const hex = Math.round(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('');
  if (includeAlpha) {
    // Always include alpha when includeAlpha is true (even if alpha is 1)
    const alphaHex = Math.round(rgba.a * 255).toString(16);
    return hex + (alphaHex.length === 1 ? '0' + alphaHex : alphaHex);
  }
  return hex;
}

export function rgbaToRgbString(rgba: RGBA): string {
  return `rgb(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(
    rgba.b,
  )})`;
}

export function rgbaToRgbaString(rgba: RGBA): string {
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(
    rgba.b,
  )}, ${rgba.a.toFixed(2)})`;
}

export function rgbaToHsl(rgba: RGBA): string {
  let r = rgba.r / 255;
  let g = rgba.g / 255;
  let b = rgba.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(
    l * 100,
  )}%)`;
}

export function rgbaToHsla(rgba: RGBA): string {
  let r = rgba.r / 255;
  let g = rgba.g / 255;
  let b = rgba.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `hsla(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(
    l * 100,
  )}%, ${rgba.a.toFixed(2)})`;
}

export function rgbaToHsb(rgba: RGBA): string {
  let r = rgba.r / 255;
  let g = rgba.g / 255;
  let b = rgba.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : Math.round((delta / max) * 100);
  const bVal = Math.round(max * 100);

  return `hsb(${h}, ${s}%, ${bVal}%)`;
}

// Convert RGBA to HSV values
export function rgbaToHsvValues(rgba: RGBA): {
  h: number;
  s: number;
  v: number;
} {
  let r = rgba.r / 255;
  let g = rgba.g / 255;
  let b = rgba.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / delta + 2) * 60;
    } else {
      h = ((r - g) / delta + 4) * 60;
    }
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return { h, s, v };
}

// Convert HSV to RGB
export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  s = s / 100;
  v = v / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Convert RGBA to HSL for color picker
export function rgbaToHslValues(rgba: RGBA): {
  h: number;
  s: number;
  l: number;
} {
  let r = rgba.r / 255;
  let g = rgba.g / 255;
  let b = rgba.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: h * 360,
    s: s * 100,
    l: l * 100,
  };
}

// Convert HSL to RGB for color picker rendering
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 1 / 6) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 2 / 6) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 3 / 6) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 4 / 6) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 5 / 6) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Helper to convert RGB object to hex string
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Convert RGBA to specified format - always include alpha when < 1
export function rgbaToFormat(rgba: RGBA, format: ColorFormat): string {
  switch (format) {
    case 'hex':
      // Use 8-digit hex when alpha < 1, otherwise 6-digit
      // When alpha is exactly 1, use 6-digit hex for cleaner output
      return rgbaToHex(rgba, rgba.a < 1);
    case 'rgb':
      // Use rgba() when alpha < 1, otherwise rgb()
      return rgba.a < 1 ? rgbaToRgbaString(rgba) : rgbaToRgbString(rgba);
    case 'css':
      // CSS format always uses rgba()
      return rgbaToRgbaString(rgba);
    case 'hsl':
      // Use hsla() when alpha < 1, otherwise hsl()
      return rgba.a < 1 ? rgbaToHsla(rgba) : rgbaToHsl(rgba);
    case 'hsb':
      // HSB doesn't have native alpha support, so use rgba() when alpha < 1
      // Otherwise use hsb() format
      if (rgba.a < 1) {
        return rgbaToRgbaString(rgba);
      }
      return rgbaToHsb(rgba);
    default:
      return rgbaToHex(rgba, rgba.a < 1);
  }
}
