// eslint-disable-next-line typescript-sort-keys/interface
export type RGB = { r: number; g: number; b: number };
export type RGBA = RGB & { a: number };
export type RichColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsb' | 'css';
export type HSV = { h: number; s: number; v: number };
export type HSL = { h: number; l: number; s: number };

// contrast ratio should be at least 4.5 for regular sized text based on WCAG guidelines
export const targetContrast = 4.5;
export const targetContrastAAA = 7;

// -------------------- Object conversions --------------------
// Normalize 3- or 6-digit hex into RGB (ignores alpha)
export function hexToRgb(value: string): RGB | undefined {
  // replace # if needed
  let hex = value.replace(/^#/, '');

  // convert 3-digit code to 6-digit hex code
  if (hex.length === 3) {
    hex = hex.replace(
      /([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])/,
      '$1$1$2$2$3$3',
    );
  }

  if (hex.length !== 6) {
    console.error(`Error: "${value}" is not a valid hex color code.`);
    return;
  }

  // convert hex to rgb values
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);

  return { r, g, b };
}

// Normalize hex color to RGBA (#RGBA or #RRGGBBAA)
export function hexToRgba(hex: string): RGBA {
  const hexWithAlpha =
    /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (
    hexWithAlpha &&
    hexWithAlpha[1] &&
    hexWithAlpha[2] &&
    hexWithAlpha[3] &&
    hexWithAlpha[4]
  ) {
    return {
      r: parseInt(hexWithAlpha[1], 16),
      g: parseInt(hexWithAlpha[2], 16),
      b: parseInt(hexWithAlpha[3], 16),
      a: parseInt(hexWithAlpha[4], 16) / 255,
    };
  }

  const shortHex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
  if (shortHex && shortHex[1] && shortHex[2] && shortHex[3]) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16),
      a: 1,
    };
  }

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result && result[1] && result[2] && result[3]) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 1,
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

// Convert HSL to RGB
export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;

  let [r, g, b] = [0, 0, 0];
  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Convert HSV values back into RGB
export function hsvToRgb({ h, s, v }: HSV): RGB {
  s = s / 100;
  v = v / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

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

// Convert RGBA to HSV values (for slider/wheel renderers)
export function rgbaToHsv({ r, g, b }: RGBA): HSV {
  r = r / 255;
  g = g / 255;
  b = b / 255;

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

// Convert RGBA into HSL numeric values (h,s,l instead of string)
// Fix rgbaToHsl saturation calculation
export function rgbaToHsl({ r, g, b }: RGBA): HSL {
  r = r / 255;
  g = g / 255;
  b = b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - (max + min)) : d / (max + min); // ← Fixed parentheses

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

// -------------------- String conversions --------------------
// Convert RGB triple to a six-digit hex string
export function rgbToHexString({ r, g, b }: RGB): string {
  return (
    '#' +
    [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
  );
}

// Represent RGBA values as a hex string, automatically includes alpha if a < 1
export function rgbaToHexString({ r, g, b, a }: RGBA): string {
  const hex =
    '#' +
    [r, g, b]
      .map((x) => {
        const hexValue = Math.round(x).toString(16);
        return hexValue.length === 1 ? '0' + hexValue : hexValue;
      })
      .join('');
  if (a < 1) {
    const alphaHex = Math.round(a * 255).toString(16);
    return hex + (alphaHex.length === 1 ? '0' + alphaHex : alphaHex);
  }
  return hex;
}

// Format RGBA as rgb() string (drops alpha)
export function rgbaToRgbString({ r, g, b }: RGBA): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Format RGBA as rgba() string (preserves alpha)
export function rgbaToRgbaString({ r, g, b, a }: RGBA): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(2)})`;
}

// Format RGBA as HSL string (returns hsl/hsla depending on alpha)
export function rgbaToHslString(rgba: RGBA): string {
  const { h, s, l } = rgbaToHsl(rgba);
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

// Format RGBA as HSLA string (includes alpha)
export function rgbaToHslaString(rgba: RGBA): string {
  const { h, s, l } = rgbaToHsl(rgba);
  const { a } = rgba;
  return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a.toFixed(2)})`;
}

// Format RGBA as HSB string (default minus alpha support)
export function rgbaToHsbString(rgba: RGBA): string {
  const { h, s, v } = rgbaToHsv(rgba);
  return `hsb(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(v)}%)`;
}

// -------------------- Format helpers --------------------
// Return string representation for the requested format
export function rgbaToFormatString(
  rgba: RGBA,
  format: RichColorFormat,
): string {
  switch (format) {
    case 'hex':
      return rgbaToHexString(rgba);
    case 'rgb':
      return rgba.a < 1 ? rgbaToRgbaString(rgba) : rgbaToRgbString(rgba);
    case 'hsl':
      return rgba.a < 1 ? rgbaToHslaString(rgba) : rgbaToHslString(rgba);
    case 'hsb':
      return rgbaToHsbString(rgba);
    case 'css':
      return rgbaToRgbaString(rgba);
    default:
      return rgbaToHexString(rgba);
  }
}

// Guess the color format from an arbitrary string
export function detectColorFormat(input: string): RichColorFormat {
  const trimmed = input.trim();
  if (/^#?[a-f\d]{3}([a-f\d]{3})?([a-f\d]{2})?$/i.test(trimmed)) {
    return 'hex';
  }
  if (/^rgb\(/i.test(trimmed)) {
    return 'rgb';
  }
  if (/^hsl\(/i.test(trimmed)) {
    return 'hsl';
  }
  if (/^hsb\(/i.test(trimmed)) {
    return 'hsb';
  }
  return 'css';
}

// -------------------- Contrast helpers --------------------
// Calculate relative luminance from an RGB triple
export function calculateLuminance({ r, g, b }: RGB): number {
  const [red, green, blue] = [r, g, b].map((c) => {
    const val = c / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// takes in luminance values to calculate contrast ratio
export function calculateContrast(lum1: number, lum2: number): number {
  return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}
