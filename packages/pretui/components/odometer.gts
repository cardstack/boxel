// Pretui — Odometer: a number whose changed digits roll into place.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { cssDeclaration } from '../pretui-css';
import { modifier } from 'ember-modifier';
import { defined, formatNumber, toNumber } from '../internal/reading-format';
import type { FormatOptionBag } from '../internal/reading-format';

// ── Odometer — the Law 5 canonical mechanism ─────────────────────────────
// "Each digit a 1ch window over a stacked 0–9 column, translateY sprung;
//  offset > 5 → offset -= 10 so every digit takes the shortest path around
//  the ring (9→0 rolls forward one, not backward nine)."
//
// That arithmetic is `rollPath` below, verbatim. Two implementation notes,
// both deliberate:
//
//  1. The rendered column is the SLICE of the 0–9 ring the digit must travel
//     (at most six cells), not the whole ring. A ring-plus-winding-offset
//     implementation drifts without bound — a counter that only ever ticks up
//     drives its units digit to +1 every update forever, and re-basing that
//     offset needs a second frame (rAF/timeout), which the realm forbids. The
//     slice keeps every position bounded, and the visible travel is identical:
//     8→3 rolls forward through 9-0-1-2, 7→3 rolls backward through 6-5-4.
//  2. The motion is ONE CSS animation whose from-state is the custom property
//     `--pretui-odo-start`; the resting transform (`--pretui-odo-rest`) is the
//     base style, so `animation: none` under prefers-reduced-motion lands on
//     the end state, never a frozen midpoint (Law 5). Replay on change comes
//     from a keyed {{#each}} — the digit's key encodes from>to, so a changed
//     digit is a new element and its animation starts fresh. No timers, no
//     JS animation loop, no transitionend bookkeeping.
//
// A11y: the whole digit track is aria-hidden with an sr-only mirror of the
// real value beside it. `@announce` defaults to 'off' — a value that rolls on
// every tick would otherwise spam a screen reader with every intermediate
// number; turn it on only where the value settles at human pace.
export interface RollFrame {
  /** the ring slice, top to bottom, as digit characters */
  cells: string[];
  /** index the window starts on (the old digit) */
  start: number;
  /** index the window rests on (the new digit) */
  rest: number;
}

/**
 * The Law 5 ring walk: shortest path from one digit to another.
 * `(to - from + 10) % 10`, then `offset > 5 → offset -= 10`.
 */
export function rollPath(from: number, to: number): RollFrame {
  let offset = (((to - from) % 10) + 10) % 10;
  if (offset > 5) {
    offset -= 10;
  }
  let steps = Math.abs(offset);
  let cells: string[] = [];
  if (offset >= 0) {
    // forward: the ring slice ascends from the old digit; the window rides up
    for (let i = 0; i <= steps; i++) {
      cells.push(String((from + i) % 10));
    }
    return { cells, start: 0, rest: steps };
  }
  // backward: the same ascending slice, entered from its bottom; window rides down
  for (let i = steps; i >= 0; i--) {
    cells.push(String((((from - i) % 10) + 10) % 10));
  }
  return { cells, start: steps, rest: 0 };
}

interface OdoSlot {
  key: string;
  digit: boolean;
  char: string;
  cells: string[];
  style: ReturnType<typeof htmlSafe>;
}

const DIGIT_RE = /[0-9]/;

export interface OdometerSignature {
  Args: {
    /** the value to display. A number is formatted through Intl; a string is used verbatim, so a pre-formatted value ('$12,480') rolls too. */
    value?: number | string;
    /** BCP-47 locale tag for number formatting; ignored when @value is a string */
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
    /** roll duration in seconds (default 0.5) */
    duration?: number;
    /** CSS timing function for the roll (default a sprung cubic-bezier) */
    ease?: string;
    /** seconds of delay added per digit so the carry cascades (default 0.03; 0 rolls every digit together) */
    stagger?: number;
    /** which end the stagger counts from: 'right' (default — the units digit leads, like a carry) or 'left' */
    staggerFrom?: 'right' | 'left';
    /** height of one digit cell, any CSS length (default 1em) */
    cellHeight?: string;
    /** live-region politeness for the sr-only value. 'off' (default) because a value that rolls on every tick would spam a screen reader; use 'polite' only where the value settles at human pace. */
    announce?: 'off' | 'polite' | 'assertive';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Blocks: {
    /** static content before the digits — read aloud before the value */
    before: [];
    /** static content after the digits — read aloud after the value */
    after: [];
  };
  Element: HTMLSpanElement;
}

// Records what the odometer just rendered, AFTER the DOM has it, so the
// next render can diff against it. This bookkeeping used to live inside the
// slots getter; a getter that writes is a side effect (ember/no-side-effects
// flags it) and it is genuinely post-render state, not derivation. Args are
// positional: the text that was just rendered, and the sink that stores it.
const recordRendered = modifier(
  (_el: HTMLElement, [text, sink]: [string, (rendered: string) => void]) => {
    sink(text);
  },
);

export class Odometer extends Component<OdometerSignature> {
  // Untracked on purpose: this is "what the DOM currently shows". It is read
  // during render (by the slots getter) and written after render (by the
  // recordRendered modifier). Tracking it would make that write a
  // backtracking violation; leaving it untracked is correct, because a
  // change to it must never by itself schedule a re-render.
  private previous: string | undefined = undefined;

  // Called by the modifier once the browser is showing `text`.
  private remember = (rendered: string) => {
    this.previous = rendered;
  };

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
    return formatNumber(
      n,
      a.locale,
      defined({
        ...(a.options ?? {}),
        style: a.style,
        currency: a.currency,
        minimumFractionDigits: a.minimumFractionDigits,
        maximumFractionDigits: a.maximumFractionDigits,
        useGrouping: a.useGrouping,
      }),
    );
  }

  get rootStyle(): ReturnType<typeof htmlSafe> {
    let a = this.args;
    // Durations are numbers we formatted ourselves; `@cellHeight` and
    // `@ease` are caller strings and clear the kit-wide allowlist first
    // (pretui-css.gts) — a rejected one falls back to the stylesheet.
    let bits = [
      `--pretui-odo-duration: ${(a.duration ?? 0.5).toFixed(3)}s`,
      `--pretui-odo-stagger: ${(a.stagger ?? 0.03).toFixed(3)}s`,
      cssDeclaration('--pretui-odo-cell', a.cellHeight ?? '1em') ??
        '--pretui-odo-cell: 1em',
    ];
    let ease = cssDeclaration('--pretui-odo-ease', a.ease);
    if (ease) {
      bits.push(ease);
    }
    return htmlSafe(bits.join('; '));
  }

  /**
   * The rendered slots, right-anchored against what the DOM currently shows,
   * so a value that grows a digit keeps its columns aligned. Characters that
   * are digits on both sides roll; everything else (separators, currency
   * marks, compact suffixes) is static — a documented edge, since a value
   * crossing '999' → '1,000' re-shapes the string and those positions snap.
   */
  get slots(): OdoSlot[] {
    let next = this.text;
    // Pure read: `previous` is whatever the DOM is currently showing. The
    // recordRendered modifier advances it after this render commits.
    let prev = this.previous ?? next;
    let shift = next.length - prev.length;
    let digitIndex = 0;
    let total = 0;
    for (let ch of next) {
      if (DIGIT_RE.test(ch)) {
        total++;
      }
    }
    let out: OdoSlot[] = [];
    for (let i = 0; i < next.length; i++) {
      let ch = next[i] as string;
      let before = prev[i - shift];
      let isDigit = DIGIT_RE.test(ch);
      let frame: RollFrame = { cells: [ch], start: 0, rest: 0 };
      if (isDigit && before !== undefined && DIGIT_RE.test(before) && before !== ch) {
        frame = rollPath(Number(before), Number(ch));
      }
      let order =
        this.args.staggerFrom === 'left' ? digitIndex : total - 1 - digitIndex;
      out.push({
        key: `${i}:${before ?? ''}>${ch}`,
        digit: isDigit,
        char: ch,
        cells: frame.cells,
        style: htmlSafe(
          `--pretui-odo-start: ${frame.start}; --pretui-odo-rest: ${frame.rest}; --pretui-odo-i: ${Math.max(order, 0)}`,
        ),
      });
      if (isDigit) {
        digitIndex++;
      }
    }
    return out;
  }

  get liveAttr(): string | undefined {
    let mode = this.args.announce ?? 'off';
    return mode === 'off' ? undefined : mode;
  }
  get isEmpty(): string | undefined {
    return toNumber(this.args.value) === undefined &&
      !(typeof this.args.value === 'string' && this.args.value !== '')
      ? 'true'
      : undefined;
  }
  <template>
    <span
      class='pretui-odometer'
      style={{this.rootStyle}}
      data-empty={{this.isEmpty}}
      data-test-pretui-odometer
      {{recordRendered this.text this.remember}}
      ...attributes
    >
      {{yield to='before'}}
      <span class='pretui-odo-track' aria-hidden='true'>
        {{#each this.slots key='key' as |slot|}}
          {{#if slot.digit}}
            <span class='pretui-odo-digit'>
              <span class='pretui-odo-strut'>{{slot.char}}</span>
              <span class='pretui-odo-ring' style={{slot.style}}>
                {{#each slot.cells as |cell|}}
                  <span class='pretui-odo-cell'>{{cell}}</span>
                {{/each}}
              </span>
            </span>
          {{else}}
            <span class='pretui-odo-char'>{{slot.char}}</span>
          {{/if}}
        {{/each}}
      </span>
      <span class='pretui-odo-sr' aria-live={{this.liveAttr}}>{{this.text}}</span>
      {{yield to='after'}}
    </span>
    <style scoped>
      .pretui-odometer {
        display: inline-flex;
        align-items: baseline;
        font-variant-numeric: tabular-nums;
        line-height: var(--pretui-odo-cell, 1em);
      }
      .pretui-odometer[data-empty='true'] {
        color: var(--muted-foreground);
      }
      .pretui-odo-track {
        display: inline-flex;
        align-items: baseline;
      }
      .pretui-odo-char {
        white-space: pre;
      }
      .pretui-odo-digit {
        position: relative;
        display: inline-block;
        /* clip-path, not overflow: hidden — an overflow-clipped inline-block
           synthesises its baseline from the bottom margin edge, which drops
           the digits below the surrounding text. Clipping keeps the strut's
           real baseline. The small vertical bleed is intentional: display
           fonts can paint cap/bowl antialiasing just outside their fractional
           line box (Space Grotesk's 5 is the visible case). A zero inset
           sheared that ink off at every Odometer size. Horizontal clipping
           remains exact, so adjacent digit columns cannot overlap. */
        clip-path: inset(-0.08em 0);
      }
      .pretui-odo-strut {
        visibility: hidden;
      }
      .pretui-odo-ring {
        position: absolute;
        inset-inline: 0;
        top: 0;
        transform: translateY(
          calc(var(--pretui-odo-rest, 0) * var(--pretui-odo-cell, 1em) * -1)
        );
        animation: pretui-odo-roll var(--pretui-odo-duration, 0.5s)
          var(--pretui-odo-ease, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
        animation-delay: calc(
          var(--pretui-odo-i, 0) * var(--pretui-odo-stagger, 0.03s)
        );
      }
      @keyframes pretui-odo-roll {
        from {
          transform: translateY(
            calc(var(--pretui-odo-start, 0) * var(--pretui-odo-cell, 1em) * -1)
          );
        }
      }
      .pretui-odo-cell {
        display: block;
        height: var(--pretui-odo-cell, 1em);
        line-height: var(--pretui-odo-cell, 1em);
        text-align: center;
      }
      .pretui-odo-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-odo-ring {
          animation: none;
        }
      }
    </style>
  </template>
}
