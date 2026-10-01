// Pretui — PathText: text set along an SVG path — a circle, an arc, a wave.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { cssStyleFrom, cssValue } from '../pretui-css';

// ═══════════════════════════════════════════════════════════════════════
// PathText
// ═══════════════════════════════════════════════════════════════════════

/** The built-in paths. `custom` uses `@path`. */
export type PathTextShape = 'circle' | 'arc' | 'wave' | 'custom';

/** Path data may only contain command letters, numbers and separators.
 * An allowlist, not a sanitiser: a `d` that contains anything else is
 * dropped whole and the preset shape is drawn instead, so a rejected value
 * costs the caller their override and never the component's rendering.
 * (Same discipline as `cssValue` in pretui-css.gts, applied to the one
 * caller string in this module that reaches an SVG attribute.) */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE ,.+-]{1,2048}$/;

/** Validate caller-supplied path data. */
export function safePathData(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  let value = raw.trim();
  if (value.length === 0 || !PATH_DATA.test(value)) {
    return undefined;
  }
  return value;
}

/** A circle path drawn as two arcs, starting at the top and running
 * clockwise — the orientation that puts the first character at 12 o'clock,
 * which is where a reader looks first. */
export function circlePath(size: number, radius: number): string {
  let centre = size / 2;
  let top = centre - radius;
  return (
    'M ' + centre + ' ' + top +
    ' a ' + radius + ' ' + radius + ' 0 1 1 -0.01 0' +
    ' a ' + radius + ' ' + radius + ' 0 1 1 0.01 0'
  );
}

/** A shallow upward arc across the box — the "banner" shape. */
export function arcPath(size: number, radius: number): string {
  let inset = size * 0.08;
  let baseline = size * 0.72;
  let sweep = Math.max(radius, size * 0.4);
  return (
    'M ' + inset + ' ' + baseline +
    ' A ' + sweep + ' ' + sweep + ' 0 0 1 ' + (size - inset) + ' ' + baseline
  );
}

/** One period of a sine-ish wave, drawn with two cubic segments. */
export function wavePath(size: number, amplitude: number): string {
  let middle = size / 2;
  let quarter = size / 4;
  return (
    'M 0 ' + middle +
    ' C ' + quarter + ' ' + (middle - amplitude) + ', ' + quarter + ' ' + (middle - amplitude) + ', ' + middle + ' ' + middle +
    ' S ' + (size - quarter) + ' ' + (middle + amplitude) + ', ' + size + ' ' + middle
  );
}

export interface PathTextSignature {
  Args: {
    /** the string to set along the path. It is the SVG's accessible name;
     * the glyphs themselves are presentation, so a repeated ring is not read
     * out three times. */
    text: string;
    /** which path (default 'circle') */
    shape?: PathTextShape;
    /** SVG path data for `@shape='custom'`. Validated against an allowlist;
     * anything unrecognised falls back to the circle. */
    path?: string;
    /** the square viewBox edge (default 240). The SVG scales to its box —
     * this only sets the coordinate space the geometry is expressed in. */
    size?: number;
    /** circle / arc radius (default 40% of size) */
    radius?: number;
    /** wave height (default 12% of size) */
    amplitude?: number;
    /** where along the path the text starts, in percent (default 0) */
    offset?: number;
    /** repeat the string around the path this many times (default 1) */
    repeat?: number;
    /** what separates the repeats (default a spaced middot) */
    separator?: string;
    /** glyph size in viewBox units (default 6% of size) */
    fontSize?: number;
    /** extra tracking in viewBox units */
    tracking?: number;
    /** fill colour. A caller string, so it goes through the kit's `cssValue`
     * allowlist before it is written. */
    fill?: string;
    /** rotate the whole ring. See the Law 5 note at the top of this module:
     * OFF by default, only meaningful for the closed shapes, and only
     * legitimate when something ongoing is being reported — pair it with a
     * text affordance saying what. */
    travel?: boolean;
    /** seconds for one full turn (default 14) */
    revolution?: number;
    /** which way it turns (default 'cw') */
    direction?: 'cw' | 'ccw';
  };
  Element: HTMLSpanElement;
}

export class PathText extends Component<PathTextSignature> {
  private guid = guidFor(this);

  get size(): number {
    let raw = this.args.size;
    return raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 240;
  }
  get shape(): PathTextShape {
    return this.args.shape ?? 'circle';
  }
  get radius(): number {
    let raw = this.args.radius;
    if (raw !== undefined && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return this.size * 0.4;
  }
  get amplitude(): number {
    let raw = this.args.amplitude;
    if (raw !== undefined && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return this.size * 0.12;
  }
  get pathData(): string {
    if (this.shape === 'custom') {
      let supplied = safePathData(this.args.path);
      if (supplied) {
        return supplied;
      }
    }
    if (this.shape === 'arc') {
      return arcPath(this.size, this.radius);
    }
    if (this.shape === 'wave') {
      return wavePath(this.size, this.amplitude);
    }
    return circlePath(this.size, this.radius);
  }
  get pathId(): string {
    return this.guid + '-path';
  }
  get pathHref(): string {
    return '#' + this.pathId;
  }
  get viewBox(): string {
    return '0 0 ' + this.size + ' ' + this.size;
  }
  get startOffset(): string {
    let raw = this.args.offset;
    let value = raw !== undefined && Number.isFinite(raw) ? raw : 0;
    return value.toFixed(2) + '%';
  }
  /** The string as it is actually drawn: the caller's text repeated, joined
   * by the separator. A single repeat is the common case and adds nothing. */
  get drawn(): string {
    let text = this.args.text ?? '';
    let raw = this.args.repeat;
    let times =
      raw !== undefined && Number.isFinite(raw) && raw >= 1
        ? Math.min(24, Math.trunc(raw))
        : 1;
    if (times <= 1) {
      return text;
    }
    let separator = this.args.separator ?? ' · ';
    let pieces: string[] = [];
    for (let i = 0; i < times; i++) {
      pieces.push(text);
    }
    return pieces.join(separator) + separator;
  }
  /** Travel is honoured only where a rotation is truthful: rotating the
   * group of an arc or a wave rotates the SHAPE too, which is a different
   * (and wrong) picture. Named, not silently ignored. */
  get travelling(): boolean {
    if (!this.args.travel) {
      return false;
    }
    return this.shape === 'circle' || this.shape === 'custom';
  }
  get textStyle() {
    let size = this.args.fontSize;
    let resolved =
      size !== undefined && Number.isFinite(size) && size > 0
        ? size
        : this.size * 0.06;
    let tracking = this.args.tracking;
    let track =
      tracking !== undefined && Number.isFinite(tracking) ? tracking : 0;
    return cssStyleFrom([
      'font-size: ' + resolved.toFixed(2) + 'px',
      'letter-spacing: ' + track.toFixed(2) + 'px',
      // The one caller STRING that reaches CSS in this module. Guarded.
      this.args.fill === undefined
        ? undefined
        : cssValue(this.args.fill) === undefined
          ? undefined
          : 'fill: ' + cssValue(this.args.fill),
    ]);
  }
  get spinStyle() {
    let raw = this.args.revolution;
    let seconds =
      raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 14;
    return htmlSafe('--pretui-pathtext-revolution: ' + seconds.toFixed(2) + 's');
  }
  <template>
    <span class='pretui-pathtext' data-test-pretui-path-text ...attributes>
      <svg
        class='pretui-pathtext-svg'
        viewBox={{this.viewBox}}
        role='img'
        aria-label={{@text}}
        data-travel={{if this.travelling 'true'}}
        data-direction={{if @direction @direction 'cw'}}
        style={{this.spinStyle}}
      >
        <defs>
          <path id={{this.pathId}} d={{this.pathData}} fill='none' />
        </defs>
        <g class='pretui-pathtext-spin'>
          <text class='pretui-pathtext-text' style={{this.textStyle}}>
            <textPath href={{this.pathHref}} startOffset={{this.startOffset}}>
              {{this.drawn}}
            </textPath>
          </text>
        </g>
      </svg>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-pathtext {
          display: inline-block;
          line-height: 0;
        }
        .pretui-pathtext-svg {
          display: block;
          width: 100%;
          height: auto;
          overflow: visible;
        }
        .pretui-pathtext-text {
          fill: var(--pretui-pathtext-fill, var(--foreground));
          font-family: var(--font-sans);
          font-weight: var(--weight-medium, 500);
        }
        /* The resting state is the finished picture: the ring is fully drawn,
           fully legible, and passes the screenshot test with the animation
           removed. Rotation only says "this is ongoing". */
        .pretui-pathtext-spin {
          transform-box: view-box;
          transform-origin: 50% 50%;
        }
        @keyframes pretui-pathtext-turn {
          to {
            rotate: 360deg;
          }
        }
        .pretui-pathtext-svg[data-travel='true'] .pretui-pathtext-spin {
          animation: pretui-pathtext-turn
            var(--pretui-pathtext-revolution, 14s) linear infinite;
        }
        .pretui-pathtext-svg[data-travel='true'][data-direction='ccw']
          .pretui-pathtext-spin {
          animation-direction: reverse;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-pathtext-spin {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
