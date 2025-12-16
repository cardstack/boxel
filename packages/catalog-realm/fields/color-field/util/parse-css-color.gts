export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Normalize any CSS color string (including modern Color Level 4 syntax) into RGBA.
export function parseCssColorWithBrowser(color: string | null | undefined): {
  rgba: RgbaColor;
  valid: boolean;
} {
  if (!color) {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
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

  return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
}

function parseWithComputedStyle(color: string): { rgba: RgbaColor; valid: boolean } {
  try {
    const temp = document.createElement('div');
    temp.style.color = '';
    temp.style.color = color;
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);

    if (!computed) {
      return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
    }

    const rgbaMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
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
    // ignore
  }

  return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
}

function parseWithCanvas(color: string): { rgba: RgbaColor; valid: boolean } {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#010101'; // sentinel to detect invalid sets

  try {
    ctx.fillStyle = color;
  } catch {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

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
