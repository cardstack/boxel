// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking'; // ³ Glimmer tracking
import { action } from '@ember/object'; // ⁴ Ember actions
import { on } from '@ember/modifier'; // ⁵ Event modifier
import Modifier from 'ember-modifier'; // ⁶ Modifier base class
import { concat, fn } from '@ember/helper'; // ⁷ Template helpers
import {
  not,
  eq,
  multiply,
  divide,
  subtract,
} from '@cardstack/boxel-ui/helpers'; // ⁷ Boxel helpers
import {
  Swatch,
  ColorPicker,
  ColorPalette,
  BoxelInput,
  Button,
  BoxelSelect,
} from '@cardstack/boxel-ui/components'; // ⁸ Boxel components
import PaletteIcon from '@cardstack/boxel-icons/palette'; // ⁹ Icons
import DropletIcon from '@cardstack/boxel-icons/droplet';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
import SlidersIcon from '@cardstack/boxel-icons/sliders-horizontal';
import PipetteIcon from '@cardstack/boxel-icons/pipette'; // Added for eyedropper

// ¹⁰ Custom modifiers for canvas interaction
class WindowMouseEventsModifier extends Modifier<{
  Element: HTMLElement;
  Args: {
    Named: {
      onMouseMove?: (event: MouseEvent) => void;
      onMouseUp?: (event: MouseEvent) => void;
    };
  };
}> {
  private mouseMoveHandler?: (event: MouseEvent) => void;
  private mouseUpHandler?: (event: MouseEvent) => void;

  modify(
    _element: HTMLElement,
    _positional: never[],
    {
      onMouseMove,
      onMouseUp,
    }: {
      onMouseMove?: (event: MouseEvent) => void;
      onMouseUp?: (event: MouseEvent) => void;
    },
  ) {
    // Remove old listeners if they exist
    this.cleanup();

    // Store new handlers
    this.mouseMoveHandler = onMouseMove;
    this.mouseUpHandler = onMouseUp;

    // Add new listeners
    if (this.mouseMoveHandler) {
      window.addEventListener('mousemove', this.mouseMoveHandler);
    }
    if (this.mouseUpHandler) {
      window.addEventListener('mouseup', this.mouseUpHandler);
    }
  }

  cleanup() {
    if (this.mouseMoveHandler) {
      window.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = undefined;
    }
    if (this.mouseUpHandler) {
      window.removeEventListener('mouseup', this.mouseUpHandler);
      this.mouseUpHandler = undefined;
    }
  }

  willDestroy() {
    this.cleanup();
  }
}

class SetupCanvasModifier extends Modifier<{
  Element: HTMLCanvasElement;
  Args: {
    Named: {
      onSetup: (element: HTMLCanvasElement) => void;
    };
  };
}> {
  modify(
    element: HTMLCanvasElement,
    _positional: never[],
    { onSetup }: { onSetup: (element: HTMLCanvasElement) => void },
  ) {
    onSetup(element);
  }
}

// ¹¹ Type definitions
export type ColorFormat =
  | 'hex' // #FF5733
  | 'rgb' // rgb(255, 87, 51)
  | 'css' // rgba(255, 87, 51, 1) - CSS format with alpha
  | 'hsl' // hsl(9, 100%, 60%)
  | 'hsb'; // HSB format (Hue, Saturation, Brightness)

// ¹¹ Configuration as discriminated union
export type ColorFieldConfiguration =
  | {
      variant: 'standard';
    }
  | {
      variant: 'full';
      options?: {
        formats?: ColorFormat[]; // Available format tabs (default: ['hex', 'rgb', 'hsl'])
        defaultFormat?: ColorFormat; // Which tab opens first (default: 'hex')
        showColorPicker?: boolean; // Show native picker? (default: true)
      };
    }
  | {
      variant: 'palette';
      options?: {
        paletteColors?: string[]; // Custom palette colors (default: ColorPalette DEFAULT_PALETTE_COLORS)
      };
    }
  | {
      variant: 'slider';
      options?: {
        formats?: ColorFormat[]; // Available slider modes (default: ['rgb'])
        defaultFormat?: ColorFormat; // Default slider mode (default: 'rgb')
      };
    };

// ¹² Color conversion utilities with alpha support
type RGBA = { r: number; g: number; b: number; a: number };

// Parse any CSS color format to RGBA using browser's built-in parser
function parseCssColor(color: string | null | undefined): RGBA {
  if (!color) return { r: 59, g: 130, b: 246, a: 1 }; // default blue

  const trimmed = color.trim();

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

function parseCssColorSafe(color: string | null | undefined): {
  rgba: RGBA;
  valid: boolean;
} {
  if (!color) {
    return { rgba: { r: 59, g: 130, b: 246, a: 1 }, valid: false };
  }

  const trimmed = color.trim();

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

function detectColorFormat(input: string): ColorFormat {
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
  return 'css';
}

function hexToRgba(hex: string): RGBA {
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

function rgbaToHex(rgba: RGBA, includeAlpha = false): string {
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

function rgbaToRgbString(rgba: RGBA): string {
  return `rgb(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(
    rgba.b,
  )})`;
}

function rgbaToRgbaString(rgba: RGBA): string {
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(
    rgba.b,
  )}, ${rgba.a.toFixed(2)})`;
}

function rgbaToHsl(rgba: RGBA): string {
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

function rgbaToHsla(rgba: RGBA): string {
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

function rgbaToHsb(rgba: RGBA): string {
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
function rgbaToHsvValues(rgba: RGBA): { h: number; s: number; v: number } {
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
function hsvToRgb(
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
function rgbaToHslValues(rgba: RGBA): { h: number; s: number; l: number } {
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
function hslToRgb(
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

// Convert RGBA to specified format - always include alpha when < 1
function rgbaToFormat(rgba: RGBA, format: ColorFormat): string {
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

// ¹⁶ Full Edit Component - interactive color picker with gradient canvas
class FullEdit extends Component<typeof ColorField> {
  // Internal HSV state - always maintained regardless of format
  @tracked h: number = 0;
  @tracked s: number = 100;
  @tracked v: number = 100;
  @tracked a: number = 1;

  @tracked selectedFormat: ColorFormat = 'css';
  @tracked isDraggingSV = false;
  @tracked isDraggingHue = false;
  @tracked isDraggingAlpha = false;
  @tracked inputValue = '';

  get eyeDropperSupported(): boolean {
    return typeof (window as any).EyeDropper !== 'undefined';
  }

  svCanvasElement: HTMLCanvasElement | null = null;
  hueCanvasElement: HTMLCanvasElement | null = null;
  alphaCanvasElement: HTMLCanvasElement | null = null;

  get options() {
    const config = this.args.configuration as
      | ColorFieldConfiguration
      | undefined;
    if (config?.variant === 'full') {
      return config.options;
    }
    return undefined;
  }

  get availableFormats(): ColorFormat[] {
    return this.options?.formats ?? ['hex', 'rgb', 'hsl'];
  }

  get defaultFormat(): ColorFormat {
    return this.options?.defaultFormat ?? 'hex';
  }

  get formatOptions() {
    return this.availableFormats.map((format) => ({
      label: format.toUpperCase(),
      value: format,
    }));
  }

  get selectedFormatOption() {
    return {
      label: this.selectedFormat.toUpperCase(),
      value: this.selectedFormat,
    };
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    const initialFormat = this.availableFormats.includes(this.defaultFormat)
      ? this.defaultFormat
      : this.availableFormats[0];
    this.selectedFormat = initialFormat;

    // Initialize internal HSV state from model
    const rgba = parseCssColor(this.args.model);
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;

    this.inputValue = this.getColorString(this.selectedFormat);
  }

  // Compute RGBA from internal HSV state
  get rgba(): RGBA {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    return { ...rgb, a: this.a };
  }

  get hsv(): { h: number; s: number; v: number } {
    return { h: this.h, s: this.s, v: this.v };
  }

  get currentColor(): string {
    const rgb = this.rgba;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
  }

  get rgbValues() {
    const { r, g, b } = this.rgba;
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
    };
  }

  get hslValues() {
    const hsl = rgbaToHslValues(this.rgba);
    return {
      h: Math.round(hsl.h),
      s: Math.round(hsl.s),
      l: Math.round(hsl.l),
    };
  }

  get hexValue() {
    return rgbaToHex(this.rgba, this.rgba.a < 1);
  }

  getColorString = (format: ColorFormat): string => {
    return rgbaToFormat(this.rgba, format);
  };

  @action
  setupSVCanvas(element: HTMLCanvasElement) {
    this.svCanvasElement = element;
    // Use requestAnimationFrame to ensure model is ready
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      if (this.alphaCanvasElement) {
        this.drawAlphaCanvas();
      }
      this.updateInputValue();
    });
  }

  @action
  setupHueCanvas(element: HTMLCanvasElement) {
    this.hueCanvasElement = element;
    // Use requestAnimationFrame to ensure model is ready
    requestAnimationFrame(() => {
      this.drawHueCanvas();
      if (this.alphaCanvasElement) {
        this.drawAlphaCanvas();
      }
    });
  }

  @action
  setupAlphaCanvas(element: HTMLCanvasElement) {
    this.alphaCanvasElement = element;
    // Use requestAnimationFrame to ensure model is ready
    requestAnimationFrame(() => {
      this.drawAlphaCanvas();
    });
  }

  @action
  updateInputValue() {
    if (document.activeElement?.tagName !== 'INPUT') {
      this.inputValue = this.getColorString(this.selectedFormat);
    }
  }

  drawSVCanvas() {
    if (!this.svCanvasElement) return;
    const canvas = this.svCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Saturation gradient (white to pure hue)
    const satGradient = ctx.createLinearGradient(0, 0, width, 0);
    satGradient.addColorStop(0, 'white');
    satGradient.addColorStop(1, `hsl(${this.hsv.h}, 100%, 50%)`);
    ctx.fillStyle = satGradient;
    ctx.fillRect(0, 0, width, height);

    // Value gradient (transparent to black)
    const valGradient = ctx.createLinearGradient(0, 0, 0, height);
    valGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    valGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = valGradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawHueCanvas() {
    if (!this.hueCanvasElement) return;
    const canvas = this.hueCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#ff0000');
    gradient.addColorStop(0.17, '#ffff00');
    gradient.addColorStop(0.33, '#00ff00');
    gradient.addColorStop(0.5, '#00ffff');
    gradient.addColorStop(0.67, '#0000ff');
    gradient.addColorStop(0.83, '#ff00ff');
    gradient.addColorStop(1, '#ff0000');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawAlphaCanvas() {
    if (!this.alphaCanvasElement) return;
    const canvas = this.alphaCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas first
    ctx.clearRect(0, 0, width, height);

    // Checkerboard background
    const squareSize = 4;
    for (let y = 0; y < height; y += squareSize) {
      for (let x = 0; x < width; x += squareSize) {
        ctx.fillStyle =
          (x / squareSize + y / squareSize) % 2 === 0 ? '#fff' : '#ccc';
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }

    // Alpha gradient - safely get RGB values
    try {
      const rgb = this.rgba;
      if (
        rgb &&
        typeof rgb.r === 'number' &&
        typeof rgb.g === 'number' &&
        typeof rgb.b === 'number'
      ) {
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    } catch (e) {
      // Fallback gradient if rgba is not available
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }

  @action
  handleSVInteraction(event: MouseEvent) {
    if (!this.svCanvasElement || !this.args.canEdit) return;
    const rect = this.svCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

    // Update internal state
    this.s = (x / rect.width) * 100;
    this.v = 100 - (y / rect.height) * 100;

    // Update the model
    this.updateColorFromHSV();
    this.drawAlphaCanvas();
  }

  @action
  handleHueInteraction(event: MouseEvent) {
    if (!this.hueCanvasElement || !this.args.canEdit) return;
    event.preventDefault();
    const rect = this.hueCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));

    // Update internal hue - keep saturation and value as they are
    this.h = (x / rect.width) * 360;

    // Update the model
    this.updateColorFromHSV();

    // Redraw canvases to reflect new hue
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleAlphaInteraction(event: MouseEvent) {
    if (!this.alphaCanvasElement || !this.args.canEdit) return;
    const rect = this.alphaCanvasElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const a = parseFloat((x / rect.width).toFixed(2));

    const newRgba = { ...this.rgba, a };

    // Keep the current format and append alpha to it
    const newColor = rgbaToFormat(newRgba, this.selectedFormat);
    this.inputValue = newColor;
    this.args.set?.(newColor);
    this.drawAlphaCanvas();
  }

  @action
  handleSVMouseDown(event: MouseEvent) {
    if (!this.args.canEdit) return;
    this.isDraggingSV = true;
    this.handleSVInteraction(event);
  }

  @action
  handleHueMouseDown(event: MouseEvent) {
    if (!this.args.canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingHue = true;
    this.handleHueInteraction(event);
  }

  @action
  handleAlphaMouseDown(event: MouseEvent) {
    if (!this.args.canEdit) return;
    this.isDraggingAlpha = true;
    this.handleAlphaInteraction(event);
  }

  @action
  handleDragMouseMove(event: MouseEvent) {
    event.preventDefault();
    if (this.isDraggingSV) {
      this.handleSVInteraction(event);
    } else if (this.isDraggingHue) {
      this.handleHueInteraction(event);
    } else if (this.isDraggingAlpha) {
      this.handleAlphaInteraction(event);
    }
  }

  @action
  handleMouseUp() {
    this.isDraggingSV = false;
    this.isDraggingHue = false;
    this.isDraggingAlpha = false;
  }

  // Central method to update color from internal HSV state
  @action
  updateColorFromHSV() {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a };
    const newColor = rgbaToFormat(newRgba, this.selectedFormat);
    this.args.set?.(newColor);
    this.inputValue = newColor;
  }

  // Update internal HSV state from external RGBA
  @action
  updateHSVFromRgba(rgba: RGBA) {
    const hsv = rgbaToHsvValues(rgba);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.a = rgba.a;
  }

  @action
  setColorFromRgba(rgba: RGBA, format?: ColorFormat) {
    // Update internal HSV state
    this.updateHSVFromRgba(rgba);

    // Update the model in the specified format
    const targetFormat = format ?? this.selectedFormat;
    const newColor = rgbaToFormat(rgba, targetFormat);
    this.args.set?.(newColor);
    this.inputValue = newColor;

    // Redraw canvases
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleFormatSelect(option: { label: string; value: ColorFormat } | null) {
    if (!option) return;
    this.selectedFormat = option.value;
    this.setColorFromRgba(this.rgba, option.value);
  }

  @action
  handleHexInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.inputValue = value;
    const parsed = parseCssColorSafe(value);
    if (!parsed.valid) return;
    this.selectedFormat = 'hex';
    this.setColorFromRgba(parsed.rgba, 'hex');
  }

  @action
  handleRgbChannelInput(channel: 'r' | 'g' | 'b', event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) return;
    const clamped = Math.max(0, Math.min(255, value));

    // Get current RGB from HSV state
    const rgb = hsvToRgb(this.h, this.s, this.v);
    const newRgba = { ...rgb, a: this.a, [channel]: clamped };

    // Update HSV from new RGB
    this.updateHSVFromRgba(newRgba);

    // Update the model
    const newColor = rgbaToFormat(newRgba, 'rgb');
    this.args.set?.(newColor);
    this.inputValue = newColor;
    this.selectedFormat = 'rgb';

    // Redraw canvases
    requestAnimationFrame(() => {
      this.drawSVCanvas();
      this.drawAlphaCanvas();
    });
  }

  @action
  handleHslChannelInput(channel: 'h' | 's' | 'l', event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) return;
    const limits = channel === 'h' ? [0, 360] : [0, 100];
    const clamped = Math.max(limits[0], Math.min(limits[1], value));
    const nextHsl = { ...this.hslValues, [channel]: clamped };
    const rgb = hslToRgb(nextHsl.h, nextHsl.s, nextHsl.l);
    this.selectedFormat = 'hsl';
    this.setColorFromRgba({ ...rgb, a: this.rgba.a }, 'hsl');
  }

  @action
  handleRgbSliderMouseDown(event: MouseEvent) {
    // Prevent the event from bubbling up which could interfere with hue slider
    event.stopPropagation();
  }

  @action
  handleColorInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.inputValue = value;
    const { rgba, valid } = parseCssColorSafe(value);
    if (!valid) return;
    const detected = detectColorFormat(value);
    this.selectedFormat = detected;
    this.setColorFromRgba(rgba, detected);
  }

  @action
  handleUniversalInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.inputValue = value;
    const { rgba, valid } = parseCssColorSafe(value);
    if (!valid) return;
    const detected = detectColorFormat(value);
    this.selectedFormat = detected;
    this.setColorFromRgba(rgba, detected);
  }

  @action
  async handleEyeDropper() {
    if (!this.args.canEdit || !this.eyeDropperSupported) return;

    try {
      const EyeDropper = (window as any).EyeDropper;
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();

      if (result && result.sRGBHex) {
        // Parse the picked color and preserve current alpha
        const pickedRgba = hexToRgba(result.sRGBHex);
        const newRgba = { ...pickedRgba, a: this.rgba.a };
        this.setColorFromRgba(newRgba);
      }
    } catch (error) {
      // User cancelled or error occurred
      console.log('Eyedropper cancelled or error:', error);
    }
  }

  <template>
    <div
      class='advanced-color-editor'
      {{WindowMouseEventsModifier
        onMouseMove=this.handleDragMouseMove
        onMouseUp=this.handleMouseUp
      }}
    >
      <!-- Interactive gradient canvas for color selection -->
      <div class='canvas-container'>
        <canvas
          width='300'
          height='200'
          class='sv-canvas'
          {{SetupCanvasModifier onSetup=this.setupSVCanvas}}
          {{on 'mousedown' this.handleSVMouseDown}}
        ></canvas>
        <!-- Cursor indicator -->
        <div
          class='cursor-indicator'
          style={{concat
            'left:'
            (multiply (divide this.hsv.s 100) 100)
            '%;'
            'top:'
            (subtract 100 (multiply (divide this.hsv.v 100) 100))
            '%;'
          }}
        ></div>
      </div>

      <!-- Hue slider to change the gradient color -->
      <div class='hue-slider-container'>
        <canvas
          width='300'
          height='12'
          class='hue-canvas'
          {{SetupCanvasModifier onSetup=this.setupHueCanvas}}
          {{on 'mousedown' this.handleHueMouseDown}}
        ></canvas>
        <!-- Hue cursor indicator -->
        <div
          class='hue-cursor'
          style={{concat 'left:' (multiply (divide this.hsv.h 360) 100) '%;'}}
        ></div>
      </div>

      <div class='controls'>
        <div class='format-switch'>
          <BoxelSelect
            @placeholder='Format'
            @options={{this.formatOptions}}
            @selected={{this.selectedFormatOption}}
            @onChange={{this.handleFormatSelect}}
            @disabled={{not @canEdit}}
            class='format-select'
            as |option|
          >
            {{option.label}}
          </BoxelSelect>
          {{#if this.eyeDropperSupported}}
            <button
              type='button'
              {{on 'click' this.handleEyeDropper}}
              disabled={{not @canEdit}}
              title='Pick color from screen'
              class='eyedropper-button'
            >
              <PipetteIcon />
            </button>
          {{/if}}
        </div>

        {{#if (eq this.selectedFormat 'rgb')}}
          <div class='input-row triple'>
            <label class='field'>
              <span>R</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.r}}
                {{on 'input' (fn this.handleRgbChannelInput 'r')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>G</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.g}}
                {{on 'input' (fn this.handleRgbChannelInput 'g')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>B</span>
              <input
                type='number'
                min='0'
                max='255'
                value={{this.rgbValues.b}}
                {{on 'input' (fn this.handleRgbChannelInput 'b')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else if (eq this.selectedFormat 'hsl')}}
          <div class='input-row triple'>
            <label class='field'>
              <span>H</span>
              <input
                type='number'
                min='0'
                max='360'
                value={{this.hslValues.h}}
                {{on 'input' (fn this.handleHslChannelInput 'h')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>S</span>
              <input
                type='number'
                min='0'
                max='100'
                value={{this.hslValues.s}}
                {{on 'input' (fn this.handleHslChannelInput 's')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
            <label class='field'>
              <span>L</span>
              <input
                type='number'
                min='0'
                max='100'
                value={{this.hslValues.l}}
                {{on 'input' (fn this.handleHslChannelInput 'l')}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{else}}
          <div class='input-row'>
            <label class='field full'>
              <span>HEX</span>
              <input
                type='text'
                value={{this.hexValue}}
                {{on 'input' this.handleHexInput}}
                {{on 'blur' this.updateInputValue}}
                disabled={{not @canEdit}}
              />
            </label>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .advanced-color-editor {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        background: var(--boxel-light-100, #f8f9fa);
        border-radius: 1rem;
      }

      .canvas-container {
        position: relative;
        width: 100%;
        border-radius: 0.75rem;
        overflow: hidden;
        border: 2px solid var(--boxel-300, #d1d5db);
      }

      .sv-canvas {
        width: 100%;
        height: auto;
        display: block;
        cursor: crosshair;
      }

      .cursor-indicator {
        position: absolute;
        width: 16px;
        height: 16px;
        border: 2px solid white;
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%);
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .hue-slider-container {
        position: relative;
        width: 100%;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 2px solid var(--boxel-300, #d1d5db);
      }

      .hue-canvas {
        width: 100%;
        height: 12px;
        display: block;
        cursor: ew-resize;
      }

      .hue-cursor {
        position: absolute;
        top: 50%;
        width: 16px;
        height: 16px;
        border: 2px solid white;
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%);
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .controls {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .format-switch {
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }

      .format-select {
        min-width: 7rem;
      }

      .input-row {
        display: flex;
        gap: 0.75rem;
        width: 100%;
      }

      .input-row.triple .field {
        flex: 1;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        flex: 1;
      }

      .field.full {
        width: 100%;
      }

      .field span {
        font-size: 0.85rem;
        color: var(--boxel-500, #6b7280);
      }

      .field input {
        width: 100%;
        padding: 0.65rem 0.75rem;
        border-radius: 0.65rem;
        border: 1px solid var(--boxel-200, #e5e7eb);
        background: white;
        font-size: 0.95rem;
      }

      .field input:disabled {
        background: var(--boxel-50, #f9fafb);
        color: var(--boxel-400, #9ca3af);
        cursor: not-allowed;
      }

      .eyedropper-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
        background: transparent;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--boxel-600, #4b5563);
      }

      .eyedropper-button:hover:not(:disabled) {
        background: var(--boxel-100, #f3f4f6);
        color: var(--boxel-800, #1f2937);
      }

      .eyedropper-button:active:not(:disabled) {
        transform: scale(0.95);
      }

      .eyedropper-button:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }

      .eyedropper-button svg {
        width: 1.25rem;
        height: 1.25rem;
      }
    </style>
  </template>
}

// ¹⁶ Palette Edit Component - uses Boxel UI ColorPalette
class PaletteEdit extends Component<typeof ColorField> {
  get options() {
    const config = this.args.configuration as
      | ColorFieldConfiguration
      | undefined;
    if (config?.variant === 'palette') {
      return config.options;
    }
    return undefined;
  }

  get paletteColors() {
    return this.options?.paletteColors;
  }

  <template>
    <ColorPalette
      @color={{@model}}
      @onChange={{@set}}
      @disabled={{not @canEdit}}
      @paletteColors={{this.paletteColors}}
    />
  </template>
}

// ¹⁷ Slider Edit Component
class SliderEdit extends Component<typeof ColorField> {
  get options() {
    const config = this.args.configuration as
      | ColorFieldConfiguration
      | undefined;
    if (config?.variant === 'slider') {
      return config.options;
    }
    return undefined;
  }

  get rgb() {
    const rgba = parseCssColor(this.args.model || '#3b82f6');
    return { r: rgba.r, g: rgba.g, b: rgba.b };
  }

  @action
  handleRgbChange(channel: 'r' | 'g' | 'b', event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const newRgb = { ...this.rgb, [channel]: parseInt(value) || 0 };
    const newColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    this.args.set?.(newColor);
  }

  @action
  handleColorChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.args.set?.(value);
  }

  <template>
    <div class='slider-variant'>
      <div
        class='color-preview-large'
        style={{concat 'background-color:' @model}}
      ></div>

      <div class='slider-controls'>
        <div class='slider-group'>
          <div class='slider-header'>
            <label class='red-label'>Red</label>
            <span class='slider-value'>{{this.rgb.r}}</span>
          </div>
          <div class='slider-row'>
            <input
              type='range'
              min='0'
              max='255'
              value={{this.rgb.r}}
              {{on 'input' (fn this.handleRgbChange 'r')}}
              disabled={{not @canEdit}}
              class='slider red-slider'
              style={{concat
                'background:linear-gradient(to right,rgb(0,'
                this.rgb.g
                ','
                this.rgb.b
                '),rgb(255,'
                this.rgb.g
                ','
                this.rgb.b
                '))'
              }}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='green-label'>Green</label>
            <span class='slider-value'>{{this.rgb.g}}</span>
          </div>
          <div class='slider-row'>
            <input
              type='range'
              min='0'
              max='255'
              value={{this.rgb.g}}
              {{on 'input' (fn this.handleRgbChange 'g')}}
              disabled={{not @canEdit}}
              class='slider green-slider'
              style={{concat
                'background:linear-gradient(to right,rgb('
                this.rgb.r
                ',0,'
                this.rgb.b
                '),rgb('
                this.rgb.r
                ',255,'
                this.rgb.b
                '))'
              }}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='blue-label'>Blue</label>
            <span class='slider-value'>{{this.rgb.b}}</span>
          </div>
          <div class='slider-row'>
            <input
              type='range'
              min='0'
              max='255'
              value={{this.rgb.b}}
              {{on 'input' (fn this.handleRgbChange 'b')}}
              disabled={{not @canEdit}}
              class='slider blue-slider'
              style={{concat
                'background:linear-gradient(to right,rgb('
                this.rgb.r
                ','
                this.rgb.g
                ',0),rgb('
                this.rgb.r
                ','
                this.rgb.g
                ',255))'
              }}
            />
          </div>
        </div>
      </div>

      <input
        type='text'
        value={{@model}}
        {{on 'input' this.handleColorChange}}
        disabled={{not @canEdit}}
        class='hex-input'
      />
      <p class='variant-description'>Visual RGB slider controls</p>
    </div>

    <style scoped>
      .slider-variant {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .color-preview-large {
        width: 100%;
        height: 6rem;
        border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      }

      .slider-controls {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .slider-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .slider-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .slider-row .slider {
        flex: 1;
      }

      .slider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .slider-header label {
        font-size: 0.875rem;
        font-weight: 600;
      }

      .red-label {
        color: #dc2626;
      }

      .green-label {
        color: #16a34a;
      }

      .blue-label {
        color: #2563eb;
      }

      .slider-value {
        font-family: var(--font-mono, monospace);
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }

      .slider {
        width: 100%;
        height: 1rem;
        border-radius: 9999px;
        appearance: none;
        cursor: pointer;
        outline: none;
      }

      .slider::-webkit-slider-runnable-track {
        width: 100%;
        height: 1rem;
        border-radius: 9999px;
      }

      .slider::-moz-range-track {
        width: 100%;
        height: 1rem;
        border-radius: 9999px;
      }

      .slider::-webkit-slider-thumb {
        appearance: none;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: white;
        border: 3px solid #1f2937;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        margin-top: -0.25rem;
      }

      .slider::-moz-range-thumb {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: white;
        border: 3px solid #1f2937;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .slider:hover::-webkit-slider-thumb {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }

      .slider:hover::-moz-range-thumb {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }

      .hex-input {
        width: 100%;
        padding: 0.5rem;
        background: var(--input, #f5f5f5);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: calc(var(--radius, 0.5rem) * 0.75);
        font-family: var(--font-mono, monospace);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
      }

      .hex-input:focus {
        outline: 2px solid var(--ring, #3b82f6);
        outline-offset: 2px;
      }

      .variant-description {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        font-style: italic;
      }
    </style>
  </template>
}

export class ColorField extends StringField {
  static displayName = 'Color Field';
  static icon = PaletteIcon;

  // ¹³ Embedded view using Swatch
  static embedded = class Embedded extends Component<typeof ColorField> {
    <template>
      <Swatch @color={{@model}} @style='round' />
    </template>
  };

  // ¹⁴ Atom view - compact swatch
  static atom = class Atom extends Component<typeof ColorField> {
    <template>
      <Swatch @color={{@model}} @style='round' />
    </template>
  };

  // ¹⁵ Fitted view - swatch display
  static fitted = class Fitted extends Component<typeof ColorField> {
    <template>
      <div class='fitted-color-display'>
        <Swatch @color={{@model}} @style='round' />
        <span class='color-value'>{{@model}}</span>
      </div>

      <style scoped>
        .fitted-color-display {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
        }
        .color-value {
          font-family: var(--font-mono, monospace);
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }
      </style>
    </template>
  };

  // ¹⁸ Main Edit Component with configuration-based variant routing
  static edit = class Edit extends Component<typeof ColorField> {
    get variant(): 'standard' | 'full' | 'palette' | 'slider' | undefined {
      const config = this.args.configuration as
        | ColorFieldConfiguration
        | undefined;
      return config?.variant;
    }

    <template>
      {{#if (eq this.variant 'full')}}
        <FullEdit
          @model={{@model}}
          @set={{@set}}
          @canEdit={{@canEdit}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.variant 'palette')}}
        <PaletteEdit
          @model={{@model}}
          @set={{@set}}
          @canEdit={{@canEdit}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.variant 'slider')}}
        <SliderEdit
          @model={{@model}}
          @set={{@set}}
          @canEdit={{@canEdit}}
          @configuration={{@configuration}}
        />
      {{else}}
        {{! No variant specified or variant is 'standard' - use base ColorField default }}
        <ColorPicker
          @color={{@model}}
          @onChange={{@set}}
          @disabled={{not @canEdit}}
        />
      {{/if}}
    </template>
  };
}
