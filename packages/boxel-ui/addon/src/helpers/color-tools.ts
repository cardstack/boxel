// eslint-disable-next-line typescript-sort-keys/interface
type RGB = { r: number; g: number; b: number };

// contrast ratio should be at least 4.5 for regular sized text based on WCAG guidelines
export const targetContrast = 4.5;

export function rgbToHex({ r, g, b }: RGB): string {
  return (
    '#' +
    [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
  );
}

// Convert 3 or 6 digit hex color code to RGB
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

// Convert HSL to RGB
export function hslToRgb(h: number, s: number, l: number): RGB {
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

// calculates luminance from RGB
// calculations are based on https://www.w3.org/TR/WCAG20-TECHS/G18.html
export function calculateLuminance({ r, g, b }: RGB): number {
  const [red, green, blue] = [r, g, b].map((c) => {
    // divide by 255 to get each color's value between 0 and 1
    const val = c / 255;
    // apply gamma correction
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  // formula for relative luminance: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// takes in luminance values to calculate contrast ratio
export function calculateContrast(lum1: number, lum2: number): number {
  // formula for contrast ratio: (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color
  return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}
