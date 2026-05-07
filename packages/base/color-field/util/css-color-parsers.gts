import {
  hexToRgba,
  hslToRgb,
  hsvToRgb,
} from '@cardstack/boxel-ui/helpers';
import type { RGBA } from '@cardstack/boxel-ui/helpers';

export type ColorParseResult = {
  rgba: RGBA;
  valid: boolean;
};

export const DEFAULT_RGBA: RGBA = { r: 59, g: 130, b: 246, a: 1 };

// Normalize CSS colors using canvas first, then computed style.
export function parseCssColorWithBrowser(color: string | null | undefined): ColorParseResult {
  if (!color) {
    return { rgba: DEFAULT_RGBA, valid: false };
  }

  const trimmed = color.trim();

  // Try canvas first (many modern color syntaxes are accepted here)
  const canvasParsed = parseWithCanvas(trimmed);
  if (canvasParsed.valid) {
    return canvasParsed;
  }

  // Then try computed style (and possibly re-run through canvas if needed)
  const computed = parseWithComputedStyle(trimmed);
  if (computed.valid) {
    return computed;
  }

  return { rgba: DEFAULT_RGBA, valid: false };
}

// Helper that feeds colors through getComputedStyle and normalizes the result.
function parseWithComputedStyle(color: string): ColorParseResult {
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      if (!CSS.supports('color', color)) {
        return { rgba: DEFAULT_RGBA, valid: false };
      }
    }
    const temp = document.createElement('div');
    temp.style.color = '';
    temp.style.color = color;
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);

    if (!computed) {
      return { rgba: DEFAULT_RGBA, valid: false };
    }

    const rgbaMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
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

    // If computed style returns a non-rgba string, try sending that back through canvas to normalize
    const viaCanvas = parseWithCanvas(computed);
    if (viaCanvas.valid) {
      return viaCanvas;
    }
  } catch {
    // ignore parsing errors
  }

  return { rgba: DEFAULT_RGBA, valid: false };
}

// Helper that draws into a 1x1 canvas to extract RGBA pixels.
function parseWithCanvas(color: string): ColorParseResult {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { rgba: DEFAULT_RGBA, valid: false };
  }

  ctx.fillStyle = '#010101'; // sentinel to detect invalid sets

  try {
    ctx.fillStyle = color;
  } catch {
    return { rgba: DEFAULT_RGBA, valid: false };
  }

  if (ctx.fillStyle === '#010101') {
    return { rgba: DEFAULT_RGBA, valid: false };
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

// Directly parse hsl()/hsla() strings into RGBA.
export function parseHslFormat(color: string): RGBA | null {
  const hslMatch = color.match(
    /^hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+))?\)$/i,
  );

  if (!hslMatch) {
    return null;
  }

  const h = parseInt(hslMatch[1], 10);
  const s = parseInt(hslMatch[2], 10);
  const l = parseInt(hslMatch[3], 10);
  const a = hslMatch[4] ? parseFloat(hslMatch[4]) : 1;

  if (
    h < 0 ||
    h > 360 ||
    s < 0 ||
    s > 100 ||
    l < 0 ||
    l > 100 ||
    a < 0 ||
    a > 1
  ) {
    return null;
  }

  const rgb = hslToRgb({ h, s, l });
  return { ...rgb, a };
}

// Directly parse hsb() strings into RGBA.
export function parseHsbFormat(color: string): RGBA | null {
  const hsbMatch = color.match(
    /^hsb\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i,
  );

  if (!hsbMatch) {
    return null;
  }

  const h = parseInt(hsbMatch[1], 10);
  const s = parseInt(hsbMatch[2], 10);
  const b = parseInt(hsbMatch[3], 10);

  if (h < 0 || h > 360 || s < 0 || s > 100 || b < 0 || b > 100) {
    return null;
  }

  const rgb = hsvToRgb({ h, s, v: b });
  return { ...rgb, a: 1 };
}

// Directly parse hex codes (#RGB[A], #RRGGBB[AA]) into RGBA.
export function parseHexFormat(color: string): RGBA | null {
  if (!/^#?[a-f\d]{3}([a-f\d]{3})?([a-f\d]{2})?$/i.test(color)) {
    return null;
  }

  try {
    return hexToRgba(color);
  } catch {
    return null;
  }
}

// Use DOM parsing (CSS.supports + computed style) to validate arbitrary color strings.
export function parseBrowserColor(color: string): ColorParseResult {
  return parseCssColorWithBrowser(color);
}
