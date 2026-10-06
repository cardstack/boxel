// Pretui — Sparkline: an inline micro-chart for a Stat or a table cell — line, area or bars, in SVG.
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { PRETUI_TONES, resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';
import { TONE_HUES } from '../internal/corner-mark';

export type SparklineKind = 'line' | 'area' | 'bar';


export interface SparklineSignature {
  Args: {
    values: number[];
    /** Required: what the series is ('Revenue, last 12 weeks'). The summary is appended. */
    label: string;
    /** 'line' (default), 'area' or 'bar'. */
    kind?: SparklineKind;
    /** Default 'primary'. Accepts the kit's tone spellings. */
    tone?: PretuiToneArg;
    /** Pixels (default 96 × 24). */
    width?: number;
    height?: number;
    /** Mark the last point with a dot (line and area). */
    showLast?: boolean;
    /** Start the scale at zero rather than the series minimum. */
    zeroBased?: boolean;
  };
  Element: SVGSVGElement;
}

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function finite(values: number[] | undefined): number[] {
  return (values ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The spark: a series drawn at the size of a word, next to the number it
 * explains. Chart is the full plot with axes; BarList ranks named rows.
 *
 * It is plain SVG with no engine and no animation. It is `role="img"`, named
 * by `@label` plus a spoken summary ("from 12 to 30, low 8, high 31"), so the
 * shape's meaning reaches a screen reader as words. The stroke scales
 * without distortion (`vector-effect: non-scaling-stroke`), and a series of
 * one value draws a flat line rather than nothing.
 */
export class Sparkline extends Component<SparklineSignature> {
  get kind(): SparklineKind {
    let k = this.args.kind;
    return k === 'area' || k === 'bar' ? k : 'line';
  }
  get width(): number {
    return Math.max(8, this.args.width ?? 96);
  }
  get height(): number {
    return Math.max(4, this.args.height ?? 24);
  }
  get values(): number[] {
    return finite(this.args.values);
  }
  get empty(): boolean {
    return this.values.length === 0;
  }
  /** Computed once per render. Bars always include zero: a bar's length
   * encodes its distance from zero, so zero has to be on the scale. */
  @cached
  private get range(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (let v of this.values) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (this.args.zeroBased || this.kind === 'bar') {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
    return { min, max };
  }
  /** y for a value, with 1px of headroom so the stroke is never clipped. */
  private y(value: number): number {
    let { min, max } = this.range;
    let h = this.height - 2;
    if (max === min) {
      return round(1 + h / 2);
    }
    return round(1 + h - ((value - min) / (max - min)) * h);
  }
  get points(): { x: number; y: number }[] {
    let values = this.values;
    let w = this.width - 2;
    let n = values.length;
    return values.map((v, i) => ({ x: round(1 + (n === 1 ? w / 2 : (i / (n - 1)) * w)), y: this.y(v) }));
  }
  get linePath(): string {
    let pts = this.points;
    if (pts.length === 1) {
      let p = (pts[0] as { x: number; y: number });
      return `M1 ${p.y} L${this.width - 1} ${p.y}`;
    }
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  }
  get areaPath(): string {
    let pts = this.points;
    let base = this.args.zeroBased ? this.y(0) : this.height - 1;
    if (pts.length === 1) {
      let p = (pts[0] as { x: number; y: number });
      return `M1 ${p.y} L${this.width - 1} ${p.y} L${this.width - 1} ${base} L1 ${base} Z`;
    }
    let first = (pts[0] as { x: number; y: number });
    let last = (pts[pts.length - 1] as { x: number; y: number });
    return `${this.linePath} L${last.x} ${base} L${first.x} ${base} Z`;
  }
  get bars(): { x: number; y: number; width: number; height: number }[] {
    let values = this.values;
    let n = values.length;
    let slot = (this.width - 2) / n;
    let gap = Math.min(2, slot * 0.25);
    // every bar stands on zero, up for positive values and down for negative
    let base = this.y(0);
    return values.map((v, i) => {
      let top = this.y(v);
      let y = Math.min(top, base);
      return {
        x: round(1 + i * slot + gap / 2),
        y,
        width: round(Math.max(1, slot - gap)),
        height: round(Math.max(1, Math.abs(base - top))),
      };
    });
  }
  get last(): { x: number; y: number } | undefined {
    return this.args.showLast && this.kind !== 'bar' ? this.points[this.points.length - 1] : undefined;
  }
  get summary(): string {
    let values = this.values;
    if (!values.length) {
      return 'no data';
    }
    let first = values[0] as number;
    let last = values[values.length - 1] as number;
    let low = Infinity;
    let high = -Infinity;
    for (let v of values) {
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    let f = (n: number) => NUMBER.format(n);
    return `from ${f(first)} to ${f(last)}, low ${f(low)}, high ${f(high)}`;
  }
  get name(): string {
    return `${this.args.label}: ${this.summary}`;
  }
  get style() {
    let tone = resolveTone(this.args.tone, PRETUI_TONES, 'primary');
    return htmlSafe(`--pretui-sparkline-hue: ${TONE_HUES[tone]}`);
  }
  isKind = (kind: SparklineKind): boolean => this.kind === kind;

  get viewBox(): string {
    return `0 0 ${this.width} ${this.height}`;
  }

  <template>
    <svg
      class='pretui-sparkline'
      role='img'
      aria-label={{this.name}}
      width={{this.width}}
      height={{this.height}}
      viewBox={{this.viewBox}}
      preserveAspectRatio='none'
      data-kind={{this.kind}}
      style={{this.style}}
      data-test-pretui-sparkline
      ...attributes
    >
      {{#unless this.empty}}
        {{#if (this.isKind 'bar')}}
          {{#each this.bars as |bar|}}
            <rect class='pretui-sparkline-bar' x={{bar.x}} y={{bar.y}} width={{bar.width}} height={{bar.height}} rx='1' />
          {{/each}}
        {{else}}
          {{#if (this.isKind 'area')}}
            <path class='pretui-sparkline-area' d={{this.areaPath}} />
          {{/if}}
          <path class='pretui-sparkline-line' d={{this.linePath}} />
          {{#if this.last}}
            <circle class='pretui-sparkline-dot' cx={{this.last.x}} cy={{this.last.y}} r='2' />
          {{/if}}
        {{/if}}
      {{/unless}}
    </svg>
    <style scoped>
      @layer PretComponent {
        .pretui-sparkline {
          display: inline-block;
          vertical-align: middle;
          overflow: visible;
          color: var(--pretui-sparkline-hue, var(--primary));
        }
        .pretui-sparkline-line {
          fill: none;
          stroke: currentColor;
          stroke-width: var(--pretui-sparkline-stroke, 1.5);
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        .pretui-sparkline-area {
          fill: currentColor;
          opacity: var(--pretui-sparkline-fill, 0.16);
          stroke: none;
        }
        .pretui-sparkline-bar {
          fill: currentColor;
        }
        .pretui-sparkline-dot {
          fill: currentColor;
          stroke: var(--card);
          stroke-width: 1;
          vector-effect: non-scaling-stroke;
        }
      }
    </style>
  </template>

}
