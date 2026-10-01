// Pretui — Watermark: a repeated faint mark over a region — texture, never information.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { cssUrl } from './aspect-ratio';

export interface WatermarkSignature {
  Args: {
    /** The mark, repeated — 'DRAFT', a name, a date. */
    text?: string;
    /** An image to tile instead of text (http, https, data:image or blob). */
    image?: string;
    /** Distance between marks, in px (default 140). */
    gap?: number;
    /** Rotation in degrees (default -22). */
    rotate?: number;
    /** Opacity of the layer, 0–0.4 (default 0.08). It is meant to fail contrast. */
    opacity?: number;
    /** Text size in px (default 14). */
    fontSize?: number;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const XML_SPECIAL = new RegExp('[&<>"\']', 'g');
// encodeURIComponent leaves these alone, and the kit's url guard refuses them.
const URL_LEFTOVERS = new RegExp("[!'()*]", 'g');

function escapeXml(text: string): string {
  return text.replace(XML_SPECIAL, (ch) => XML_ESCAPES[ch] ?? ch);
}

/**
 * Law 6: texture never carries information. A watermark says "this is a
 * draft" to someone glancing at a screenshot, and nothing to a screen reader
 * — the layer is `aria-hidden` and ignores the pointer. When the state
 * matters, say it in words too (a Chip, a banner).
 *
 * Text is drawn as an SVG mask, so its ink is a theme colour
 * (`--pretui-watermark-ink`) rather than a hex baked into a data URI, and a
 * dark season gets a light mark. The SVG and any `@image` reach CSS only
 * through the kit's url guard.
 */
export class Watermark extends Component<WatermarkSignature> {
  get gap(): number {
    return clamp(this.args.gap, 140, 40, 600);
  }
  get rotate(): number {
    return clamp(this.args.rotate, -22, -90, 90);
  }
  get opacity(): number {
    return clamp(this.args.opacity, 0.08, 0, 0.4);
  }
  get fontSize(): number {
    return clamp(this.args.fontSize, 14, 8, 72);
  }
  get imageUrl(): string | undefined {
    return cssUrl(this.args.image);
  }
  get textUrl(): string | undefined {
    let text = (this.args.text ?? '').trim();
    if (!text || this.imageUrl) {
      return undefined;
    }
    let size = this.gap;
    let half = size / 2;
    let svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<text x="${half}" y="${half}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-family="system-ui, sans-serif" font-size="${this.fontSize}" font-weight="600" ` +
      `transform="rotate(${this.rotate} ${half} ${half})">${escapeXml(Array.from(text).slice(0, 80).join(''))}</text></svg>`;
    let encoded = encodeURIComponent(svg).replace(
      URL_LEFTOVERS,
      (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
    );
    return cssUrl('data:image/svg+xml,' + encoded);
  }
  get hasMark(): boolean {
    return Boolean(this.imageUrl || this.textUrl);
  }
  get layerStyle() {
    let parts = [`opacity: ${this.opacity}`];
    if (this.imageUrl) {
      parts.push(`background-image: ${this.imageUrl}`, `background-size: ${this.gap}px`);
    } else if (this.textUrl) {
      parts.push(`mask-image: ${this.textUrl}`, `-webkit-mask-image: ${this.textUrl}`);
      parts.push(`mask-size: ${this.gap}px`, `-webkit-mask-size: ${this.gap}px`);
    }
    return htmlSafe(parts.join('; '));
  }

  <template>
    <div class='pretui-watermark' data-test-pretui-watermark ...attributes>
      {{yield}}
      {{#if this.hasMark}}
        <div
          class='pretui-watermark-layer'
          data-kind={{if this.imageUrl 'image' 'text'}}
          style={{this.layerStyle}}
          aria-hidden='true'
          data-test-pretui-watermark-layer
        ></div>
      {{/if}}
    </div>
    <style scoped>
      .pretui-watermark {
        position: relative;
        isolation: isolate;
        min-inline-size: 0;
      }
      .pretui-watermark-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        border-radius: inherit;
        background-repeat: repeat;
        mask-repeat: repeat;
        -webkit-mask-repeat: repeat;
      }
      .pretui-watermark-layer[data-kind='text'] {
        background-color: var(--pretui-watermark-ink, var(--foreground));
      }
      @media print {
        .pretui-watermark-layer {
          print-color-adjust: exact;
        }
      }
    </style>
  </template>
}
