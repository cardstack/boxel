// Pretui — Stat: the KPI headline: a rolling number, a delta and a comparison hint.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { Delta } from './delta';
import { Odometer } from './odometer';
import { formatNumber, toNumber } from '../internal/reading-format';
import type { FormatOptionBag } from '../internal/reading-format';

export interface StatSignature {
  Args: {
    /** the eyebrow above the number — a short noun phrase, set mono and uppercase */
    label: string;
    /**
     * The headline value. A number is formatted through Intl using the format
     * knobs below; a string is used verbatim, so a pre-formatted value
     * ('61%', '9 d', '$12,480') renders exactly as written and still rolls.
     */
    value: number | string;
    /** signed change since the comparison period, rendered as a `Delta` */
    delta?: number;
    /** custom text for the delta — passed straight to `Delta`'s own `@format` */
    deltaFormat?: (n: number) => string;
    /** small print beside the delta naming the comparison window ('vs spring') */
    hint?: string;
    /**
     * Roll the headline digits when the value changes (default true). Set
     * false for a value that is really a word, or for a headline that must
     * wrap — the digit track is an inline-flex row and does not break lines.
     */
    roll?: boolean;
    /** BCP-47 locale tag for number formatting; ignored when `@value` is a string */
    locale?: string;
    /** 'decimal' (default), 'currency', 'percent' or 'unit' */
    style?: 'decimal' | 'currency' | 'percent' | 'unit';
    /** ISO 4217 code for style='currency'; without it the style degrades to decimal */
    currency?: string;
    /** floor on fraction digits */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits */
    maximumFractionDigits?: number;
    /** grouping separators (default: the locale's own choice) */
    useGrouping?: boolean | 'always' | 'auto' | 'min2';
    /** any Intl.NumberFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
    /**
     * Live-region politeness for the value a screen reader actually reads.
     * 'off' (default) because a KPI that rolls on every tick would otherwise
     * spam; 'polite' only where the value settles at human pace.
     */
    announce?: 'off' | 'polite' | 'assertive';
    /** roll duration in seconds (default 0.5) */
    duration?: number;
    /** CSS timing function for the roll (default a sprung cubic-bezier) */
    ease?: string;
    /** seconds of delay per digit so the carry cascades (default 0.03; 0 rolls together) */
    stagger?: number;
    /** which end the stagger counts from: 'right' (default, like a carry) or 'left' */
    staggerFrom?: 'right' | 'left';
    /**
     * Reserve this many digit columns of width up front. Nothing inside the
     * block moves when a value grows a column, but the block itself widens —
     * which shifts the next KPI in a row. Set it to the widest value the
     * metric can reach ('999' → '1,000' wants 5) and the row stops reflowing.
     * Unset (default) the box is content-sized.
     */
    minDigits?: number;
  };
  Element: HTMLDivElement;
}

// ── Stat — the KPI headline ──────────────────────────────────────────────
// Ported from the Tremor KPI card (big number, delta chip, comparison hint).
// Composes two kit primitives rather than re-cutting either: `Delta` (ink)
// for the signed change, and `Odometer` (reading-format) for the headline
// number — Law 5's canonical numeric mechanism, where each digit is a window
// over a 0–9 ring and takes the shortest path around it.
//
// Better than the inspiration:
//   - Tremor's KPI number is a static string; a metric that ticks swaps in
//     place and the reader has to diff two frames from memory. Here the
//     digits ROLL, which is exactly the state transition Law 5 says motion is
//     for. It costs nothing at rest: the first paint is identical to plain
//     text (Odometer has no previous value to travel from), and a value that
//     never changes never animates.
//   - The upstream takes a pre-formatted string only, so every caller writes
//     its own `Intl` call. `@value` here also accepts a raw number and the
//     format knobs ride through to Odometer, so the formatting lives in ONE
//     place for the whole kit. A string is still used verbatim, so '61%' and
//     '9 d' read exactly as written — and still roll, since Odometer rolls
//     the digit positions of any string.
//   - The label sits at the inline start of its own grid row, so a value that
//     grows a column ('999' → '1,000') extends to the inline END and nothing
//     inside the block shifts. What CAN shift is the block's own width, and
//     with it a sibling KPI in a row — `@minDigits` reserves the columns up
//     front so the row never reflows.
//
// Dropped from the Odometer surface deliberately: `@cellHeight`. Stat derives
// it from its own headline line-height (`--pretui-stat-line`) so the digit
// cells and the text line box are the same height; letting a caller set them
// apart is the one knob that CAN move the label.
export class Stat extends Component<StatSignature> {
  get hasDelta() {
    return this.args.delta !== undefined;
  }
  get deltaValue() {
    return this.args.delta ?? 0;
  }
  /** rolling is the default; @roll={{false}} falls back to plain text */
  get rolling() {
    return this.args.roll ?? true;
  }
  // One digit cell === one headline line box. Expressed against the same
  // custom property the CSS line-height reads, so a consumer that restyles
  // `--pretui-stat-line` moves both together and the baseline stays put.
  cellHeight = 'calc(var(--pretui-stat-line, 1.2) * 1em)';

  get valueStyle(): ReturnType<typeof htmlSafe> | undefined {
    let digits = this.args.minDigits;
    return digits && digits > 0
      ? htmlSafe(`--pretui-stat-min-digits: ${Math.trunc(digits)}`)
      : undefined;
  }

  // The non-rolling branch. Same `formatNumber` the Odometer path runs
  // through — the formatting is reused, not re-implemented, so the two
  // branches cannot print a value differently.
  get text(): string {
    let raw = this.args.value;
    if (typeof raw === 'string' && raw !== '') {
      return raw;
    }
    let n = toNumber(raw);
    if (n === undefined) {
      return this.args.placeholder ?? '—';
    }
    let a = this.args;
    return formatNumber(n, a.locale, {
      ...(a.options ?? {}),
      style: a.style,
      currency: a.currency,
      minimumFractionDigits: a.minimumFractionDigits,
      maximumFractionDigits: a.maximumFractionDigits,
      useGrouping: a.useGrouping,
    });
  }
  <template>
    <div class='pretui-stat' data-test-pretui-stat ...attributes>
      <span class='pretui-stat-label'>{{@label}}</span>
      <span
        class='pretui-stat-value'
        style={{this.valueStyle}}
      >{{#if this.rolling}}<Odometer
            @value={{@value}}
            @locale={{@locale}}
            @style={{@style}}
            @currency={{@currency}}
            @minimumFractionDigits={{@minimumFractionDigits}}
            @maximumFractionDigits={{@maximumFractionDigits}}
            @useGrouping={{@useGrouping}}
            @options={{@options}}
            @placeholder={{@placeholder}}
            @announce={{@announce}}
            @duration={{@duration}}
            @ease={{@ease}}
            @stagger={{@stagger}}
            @staggerFrom={{@staggerFrom}}
            @cellHeight={{this.cellHeight}}
          />{{else}}{{this.text}}{{/if}}</span>
      <span class='pretui-stat-foot'>
        {{#if this.hasDelta}}<Delta @value={{this.deltaValue}} @format={{@deltaFormat}} />{{/if}}
        {{#if @hint}}<span class='pretui-stat-hint'>{{@hint}}</span>{{/if}}
      </span>
    </div>
    <style scoped>
      .pretui-stat {
        display: grid;
        gap: 3px;
        align-content: start;
      }
      .pretui-stat-label {
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-stat-value {
        font-size: var(--text-stat, 25px);
        font-weight: 600;
        letter-spacing: var(--track-heading, -0.02em);
        font-variant-numeric: tabular-nums;
        line-height: var(--pretui-stat-line, 1.2);
        /* Column reservation (@minDigits): one tabular digit advance is 1ch
           plus the tracking that follows it. Unset it resolves to 0 and the
           box is content-sized exactly as before. */
        min-width: calc(
          var(--pretui-stat-min-digits, 0) *
            (1ch + var(--track-heading, -0.02em))
        );
      }
      .pretui-stat-foot {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .pretui-stat-hint {
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}
