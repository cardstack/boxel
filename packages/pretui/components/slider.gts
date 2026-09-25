// Pretui — Slider: native range (one thumb or two overlaid). Keyboard,
// touch and pointer stay with the platform.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { emit } from '../pretui-primitives';
import type { ControlNotifyArgs } from '../pretui-primitives';

export interface SliderSignature {
  /** the notify pair carries the single-value mode; range mode has its own */
  Args: ControlNotifyArgs<number> & {
    value?: number;
    defaultValue?: number;
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    ticks?: (string | number)[];
    /**
     * Two-thumb range mode. Inferred whenever `@values`/`@defaultValues` is
     * supplied; set it explicitly to start a range at [min, max].
     */
    range?: boolean;
    /** the [lower, upper] pair in range mode */
    values?: [number, number];
    defaultValues?: [number, number];
    onValuesChange?: (values: [number, number]) => void;
    /** alias — Radix/Mantine spell the range notify `onRangeChange` */
    onRangeChange?: (values: [number, number]) => void;
    /**
     * Snap to a derived ladder of intervals rather than to raw values, and
     * widen the rail to the enclosing interval boundaries
     * (`floor(min/interval)*interval … ceil(max/interval)*interval`). This is
     * what makes a range slider read as decades, price bands or size buckets
     * instead of as arbitrary numbers.
     */
    interval?: number;
    /**
     * Renders the value a reader hears. Without it a stepped slider announces
     * the raw number — "1990" is fine, "3" for the fourth decade is not. Feeds
     * `aria-valuetext` in both modes.
     */
    formatValue?: (value: number) => string;
    /** cap on derived tick labels; every Nth is drawn (default 12) */
    maxTicks?: number;
  };
  Element: HTMLDivElement;
}

/**
 * Single value, or a two-thumb range.
 *
 * Range mode is **two overlaid native `<input type='range'>` elements**, not a
 * div with pointer maths: one native input cannot carry two thumbs, and the
 * native pair hands over the whole keyboard (arrows, PageUp/PageDown,
 * Home/End), touch, and pointer capture for free. The two failures that
 * pattern normally has are both fixed here — the track takes no pointer
 * events and the thumbs take them all, so the two thumbs never fight except
 * when they coincide exactly, and that one case is resolved by raising
 * whichever thumb is trapped against an end rather than always raising the
 * lower one.
 */
export class Slider extends Component<SliderSignature> {
  @tracked internal = this.args.defaultValue ?? this.args.min ?? 0;
  @tracked internalLow = this.args.defaultValues?.[0];
  @tracked internalHigh = this.args.defaultValues?.[1];
  get min() {
    return this.args.min ?? 0;
  }
  get max() {
    return this.args.max ?? 100;
  }
  get isRange() {
    return (
      this.args.range ??
      (this.args.values !== undefined || this.args.defaultValues !== undefined)
    );
  }
  /** Rail bounds widen to the enclosing interval boundaries so every thumb
   * position is a meaningful interval, never a fraction of one. */
  get railMin() {
    let i = this.args.interval;
    return i ? Math.floor(this.min / i) * i : this.min;
  }
  get railMax() {
    let i = this.args.interval;
    return i ? Math.ceil(this.max / i) * i : this.max;
  }
  get stepSize() {
    return this.args.interval ?? this.args.step ?? 1;
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  get low() {
    return this.args.values?.[0] ?? this.internalLow ?? this.railMin;
  }
  get high() {
    return this.args.values?.[1] ?? this.internalHigh ?? this.railMax;
  }
  private pct(v: number) {
    let span = this.railMax - this.railMin;
    if (span <= 0) return 0;
    return ((v - this.railMin) / span) * 100;
  }
  get trackStyle() {
    return htmlSafe(`--pretui-slider-pct: ${this.pct(this.value)}%`);
  }
  get rangeStyle() {
    return htmlSafe(
      `--pretui-slider-from: ${this.pct(this.low)}%; --pretui-slider-to: ${this.pct(this.high)}%`,
    );
  }
  /** Which input paints on top. Only matters when the two thumbs coincide:
   * raise the one that would otherwise be unreachable — the lower thumb when
   * they are pinned at the top of the rail, the upper thumb everywhere else
   * (which is the case at the bottom of the rail). */
  get raised(): 'low' | 'high' | undefined {
    if (this.low !== this.high) return undefined;
    return this.low >= this.railMax ? 'low' : 'high';
  }
  private text(v: number) {
    return this.args.formatValue?.(v);
  }
  get valueText() {
    return this.text(this.value);
  }
  get lowText() {
    return this.text(this.low);
  }
  get highText() {
    return this.text(this.high);
  }
  get lowLabel() {
    return `${this.args.label ?? 'Range'} minimum`;
  }
  get highLabel() {
    return `${this.args.label ?? 'Range'} maximum`;
  }
  /** Ticks: the caller's list, or one derived from the interval ladder and
   * thinned to `@maxTicks` so a 1–1000 rail at interval 1 does not try to
   * draw a thousand markers. */
  get tickList(): (string | number)[] {
    if (this.args.ticks) return this.args.ticks;
    let i = this.args.interval;
    if (!i) return [];
    let all: number[] = [];
    for (let v = this.railMin; v <= this.railMax; v += i) {
      all.push(Number(v.toFixed(6)));
    }
    let cap = this.args.maxTicks ?? 12;
    let every = Math.max(1, Math.ceil(all.length / cap));
    return all
      .filter((_, idx) => idx % every === 0 || idx === all.length - 1)
      .map((v) => this.text(v) ?? v);
  }
  handleInput = (ev: Event) => {
    let v = Number((ev.target as HTMLInputElement).value);
    if (this.args.value === undefined) {
      this.internal = v;
    }
    emit([this.args.onValueChange, this.args.onChange], v);
  };
  private commit(next: [number, number]) {
    if (this.args.values === undefined) {
      this.internalLow = next[0];
      this.internalHigh = next[1];
    }
    emit([this.args.onValuesChange, this.args.onRangeChange], next);
  }
  // Clamp against the sibling rather than against the input's own min/max, so
  // an over-drag parks the thumb on its neighbour instead of silently
  // no-op-ing (the source's bug: it compared against a possibly-undefined
  // steps entry and dropped the event).
  handleLow = (ev: Event) => {
    let v = Number((ev.target as HTMLInputElement).value);
    this.commit([Math.min(v, this.high), this.high]);
  };
  handleHigh = (ev: Event) => {
    let v = Number((ev.target as HTMLInputElement).value);
    this.commit([this.low, Math.max(v, this.low)]);
  };
  <template>
    <div class='pretui-sliderwrap' data-test-pretui-slider ...attributes>
      {{#if this.isRange}}
        <div
          class='pretui-slider-rail'
          data-raised={{this.raised}}
          style={{this.rangeStyle}}
        >
          <input
            type='range'
            class='pretui-slider pretui-slider-low'
            aria-label={{this.lowLabel}}
            aria-valuetext={{this.lowText}}
            min={{this.railMin}}
            max={{this.railMax}}
            step={{this.stepSize}}
            value={{this.low}}
            {{on 'input' this.handleLow}}
          />
          <input
            type='range'
            class='pretui-slider pretui-slider-high'
            aria-label={{this.highLabel}}
            aria-valuetext={{this.highText}}
            min={{this.railMin}}
            max={{this.railMax}}
            step={{this.stepSize}}
            value={{this.high}}
            {{on 'input' this.handleHigh}}
          />
        </div>
      {{else}}
        <input
          type='range'
          class='pretui-slider pretui-slider-single'
          aria-label={{if @label @label 'Slider'}}
          aria-valuetext={{this.valueText}}
          min={{this.railMin}}
          max={{this.railMax}}
          step={{this.stepSize}}
          value={{this.value}}
          style={{this.trackStyle}}
          {{on 'input' this.handleInput}}
        />
      {{/if}}
      {{#if this.tickList}}
        <div class='pretui-ticks' aria-hidden='true'>
          {{#each this.tickList as |t|}}<span>{{t}}</span>{{/each}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .pretui-sliderwrap {
        display: grid;
        gap: 4px;
      }
      .pretui-slider {
        appearance: none;
        width: 100%;
        height: 3px;
        border-radius: 2px;
        background: var(--line-strong, var(--boxel-400));
        outline-offset: 4px;
      }
      .pretui-slider-single {
        background: linear-gradient(
          to right,
          var(--primary) var(--pretui-slider-pct, 50%),
          var(--line-strong, var(--boxel-400)) var(--pretui-slider-pct, 50%)
        );
      }
      /* One thumb rule per engine. Firefox implements neither the WebKit
         pseudo-element nor the track one, so styling only
         ::-webkit-slider-thumb left every Firefox reader looking at the UA
         default control — a visible break in a kit that claims one look. */
      .pretui-slider::-webkit-slider-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--card);
        box-shadow: 0 0 0 1px var(--line-strong, var(--boxel-400)), 0 1px 3px var(--shadow-ink-mid, rgb(0 0 0 / 0.08));
        cursor: pointer;
        pointer-events: auto;
      }
      .pretui-slider::-moz-range-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        border: 0;
        border-radius: 50%;
        background: var(--card);
        box-shadow: 0 0 0 1px var(--line-strong, var(--boxel-400)), 0 1px 3px var(--shadow-ink-mid, rgb(0 0 0 / 0.08));
        cursor: pointer;
        pointer-events: auto;
      }
      .pretui-slider::-moz-range-track {
        height: 3px;
        border-radius: 2px;
        background: transparent;
      }
      /* Range mode: both inputs occupy the same 3px rail, which paints the
         selected band; the inputs themselves are transparent and inert except
         for their thumbs. */
      .pretui-slider-rail {
        position: relative;
        display: grid;
        height: 14px;
        align-items: center;
      }
      .pretui-slider-rail::before {
        content: '';
        position: absolute;
        inset-inline: 0;
        height: 3px;
        border-radius: 2px;
        background: linear-gradient(
          to right,
          var(--line-strong, var(--boxel-400)) var(--pretui-slider-from, 0%),
          var(--primary) var(--pretui-slider-from, 0%),
          var(--primary) var(--pretui-slider-to, 100%),
          var(--line-strong, var(--boxel-400)) var(--pretui-slider-to, 100%)
        );
      }
      .pretui-slider-rail .pretui-slider {
        grid-area: 1 / 1;
        background: transparent;
        /* the track ignores the pointer so the two stacked inputs never
           swallow each other's drags; only the thumbs are hit targets */
        pointer-events: none;
      }
      .pretui-slider-rail[data-raised='low'] .pretui-slider-low,
      .pretui-slider-rail[data-raised='high'] .pretui-slider-high {
        z-index: var(--pretui-z-raised, 1);
      }
      .pretui-ticks {
        display: flex;
        justify-content: space-between;
        font-family: var(--font-mono);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}


export interface RangeSliderSignature {
  Args: Omit<
    SliderSignature['Args'],
    'range' | 'value' | 'defaultValue' | 'onChange' | 'onValueChange'
  >;
  Element: HTMLDivElement;
}

// Slider with range mode forced on, under the Mantine / Ant / MUI name; the
// single-value args have no meaning here and are not forwarded.
export const RangeSlider: TemplateOnlyComponent<RangeSliderSignature> =
  <template>
    <Slider
      @range={{true}}
      @values={{@values}}
      @defaultValues={{@defaultValues}}
      @onValuesChange={{@onValuesChange}}
      @onRangeChange={{@onRangeChange}}
      @label={{@label}}
      @min={{@min}}
      @max={{@max}}
      @step={{@step}}
      @ticks={{@ticks}}
      @interval={{@interval}}
      @formatValue={{@formatValue}}
      @maxTicks={{@maxTicks}}
      ...attributes
    />
  </template>;
