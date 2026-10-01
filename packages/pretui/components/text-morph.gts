// Pretui — TextMorph: text that morphs from one string to the next.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

// ═══════════════════════════════════════════════════════════════════════
// TextMorph
// ═══════════════════════════════════════════════════════════════════════

/** What happens to one glyph across a morph. */
export type MorphRole = 'keep' | 'out' | 'in';

/** One glyph's part in the morph, in final render order. */
export interface MorphStep {
  ch: string;
  role: MorphRole;
}

/** Beyond this length the quadratic diff is skipped — a morph between two
 * paragraphs is not a thing anyone can read anyway, and the component must
 * never become the reason a render is slow. */
const MORPH_LIMIT = 240;

/**
 * The shared-letter plan for morphing `from` into `to`.
 *
 * A longest-common-subsequence diff, which is what makes this component
 * different from a cross-fade: letters present in BOTH strings, in the same
 * relative order, keep their identity and stay put, so `Da Hong Pao` →
 * `Da Yu Ling` visibly keeps its `Da ` and its `o`. The reader sees the two
 * strings are relatives. Every other implementation of this effect that is
 * not motion-primitives' just fades one out and the other in, which
 * communicates nothing.
 *
 * Pure, and the whole reason this is testable without a browser.
 */
export function morphPlan(from: string, to: string): MorphStep[] {
  let a = Array.from(from ?? '');
  let b = Array.from(to ?? '');
  if (a.length === 0) {
    return b.map((ch) => ({ ch, role: 'in' as const }));
  }
  if (b.length === 0) {
    return a.map((ch) => ({ ch, role: 'out' as const }));
  }
  if (a.length > MORPH_LIMIT || b.length > MORPH_LIMIT) {
    return [
      ...a.map((ch) => ({ ch, role: 'out' as const })),
      ...b.map((ch) => ({ ch, role: 'in' as const })),
    ];
  }

  // Classic LCS table. Rows are `a`, columns are `b`.
  let table: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    table.push(new Array<number>(b.length + 1).fill(0));
  }
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      let row = table[i] as number[];
      let below = table[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }

  let steps: MorphStep[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      steps.push({ ch: b[j] as string, role: 'keep' });
      i++;
      j++;
      continue;
    }
    let below = table[i + 1] as number[];
    let row = table[i] as number[];
    if ((below[j] as number) >= (row[j + 1] as number)) {
      steps.push({ ch: a[i] as string, role: 'out' });
      i++;
    } else {
      steps.push({ ch: b[j] as string, role: 'in' });
      j++;
    }
  }
  while (i < a.length) {
    steps.push({ ch: a[i] as string, role: 'out' });
    i++;
  }
  while (j < b.length) {
    steps.push({ ch: b[j] as string, role: 'in' });
    j++;
  }
  return steps;
}

interface MorphCell {
  key: string;
  ch: string;
  role: MorphRole;
  style: ReturnType<typeof htmlSafe>;
}

export interface TextMorphSignature {
  Args: {
    /** the CURRENT string. Changing it is what triggers a morph — the
     * component remembers what it was showing, so a caller never has to pass
     * both halves. Mirrored in an sr-only span; the glyph stack is
     * `aria-hidden`. */
    text: string;
    /** seconds one glyph takes to leave or arrive (default 0.32) */
    duration?: number;
    /** seconds between consecutive glyphs (default 0.012). Set it to 0 for
     * a single simultaneous swap. */
    stagger?: number;
    /** the string being morphed FROM, stated explicitly. Supply it and the
     * render is a pure function of the arguments with no memory involved —
     * preferable wherever the caller already holds both strings. Omit it and
     * the component remembers what it last showed. */
    from?: string;
  };
  Element: HTMLSpanElement;
}

export class TextMorph extends Component<TextMorphSignature> {
  // All four are deliberately UNTRACKED. They are a memo over @text (which
  // IS tracked, so anything reading it recomputes when it changes), and
  // tracking them would turn the memo write into a backtracking re-render.
  //
  // The memo lives in a METHOD rather than a getter for two reasons. The
  // lint gate rejects assignment inside a getter (ember/no-side-effects) and
  // it is right to: a getter that mutates is invisible to a reader and to
  // the tracking system alike. Written as a call, the memo is something the
  // template asks for once per render, on purpose.
  private previousText = '';
  private currentText: string | undefined;
  private generation = 0;
  private cached: MorphStep[] = [];

  /** The current plan, recomputing it if @text has moved on since the last
   * time it was asked for. Idempotent: calling it twice in one render
   * returns the same array and bumps nothing. */
  private currentPlan(): MorphStep[] {
    let next = this.args.text ?? '';
    let stated = this.args.from;
    if (stated !== undefined) {
      // Fully controlled: no memory, and the era is the pair itself so a
      // change to either string rebuilds the spans and restarts the CSS.
      return morphPlan(stated, next);
    }
    if (next !== this.currentText) {
      this.previousText = this.currentText ?? '';
      this.currentText = next;
      this.generation = this.generation + 1;
      this.cached = morphPlan(this.previousText, next);
    }
    return this.cached;
  }

  /** The identity stamp mixed into every span key. Changing it is how a CSS
   * animation is restarted without a timer: the element is a new element. */
  private currentEra(): string {
    let stated = this.args.from;
    if (stated !== undefined) {
      return stated.length + '>' + (this.args.text ?? '').length + ':' + stated;
    }
    return String(this.generation);
  }

  get duration(): number {
    let raw = this.args.duration;
    return raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 0.32;
  }
  get stagger(): number {
    let raw = this.args.stagger;
    return raw !== undefined && Number.isFinite(raw) && raw >= 0 ? raw : 0.012;
  }
  get containerStyle(): ReturnType<typeof htmlSafe> {
    return htmlSafe(
      '--pretui-morph-dur: ' +
        this.duration.toFixed(3) +
        's; --pretui-morph-step: ' +
        this.stagger.toFixed(3) +
        's',
    );
  }
  get cells(): MorphCell[] {
    let steps = this.currentPlan();
    let era = this.currentEra();
    return steps.map((step, index) => ({
      key: era + ':' + index + ':' + step.role + ':' + step.ch,
      ch: step.ch,
      role: step.role,
      style: htmlSafe('--pretui-morph-i: ' + index),
    }));
  }

  <template>
    <span
      class='pretui-morph'
      style={{this.containerStyle}}
      data-test-pretui-text-morph
      ...attributes
    >
      <span aria-hidden='true'>
        {{~#each this.cells key='key' as |cell|~}}
          <span
            class='pretui-morph-cell'
            data-role={{cell.role}}
            style={{cell.style}}
          >{{cell.ch}}</span>
        {{~/each~}}
      </span>
      <span class='pretui-morph-sr'>{{@text}}</span>
    </span>
    <style scoped>
      .pretui-morph {
        display: inline-block;
        white-space: pre;
      }
      .pretui-morph-cell {
        display: inline-block;
        white-space: pre;
      }
      /* END STATE for a departing glyph: gone. Collapsing the font-size
         rather than the width is the trick wave 1 established — it takes the
         glyph's advance width with it exactly, so the surviving letters
         close the gap with no measuring. */
      .pretui-morph-cell[data-role='out'] {
        font-size: 0;
        opacity: 0;
        animation: pretui-morph-out var(--pretui-morph-dur, 0.32s)
          cubic-bezier(0.4, 0, 1, 1) both;
        animation-delay: calc(
          var(--pretui-morph-i, 0) * var(--pretui-morph-step, 0.012s)
        );
      }
      @keyframes pretui-morph-out {
        from {
          font-size: 1em;
          opacity: 1;
          translate: 0 0;
        }
        to {
          font-size: 0;
          opacity: 0;
          translate: 0 -0.35em;
        }
      }
      /* END STATE for an arriving glyph: present. Arrivals wait for the
         departures, so the line never overshoots its final width. */
      .pretui-morph-cell[data-role='in'] {
        font-size: 1em;
        opacity: 1;
        animation: pretui-morph-in var(--pretui-morph-dur, 0.32s)
          cubic-bezier(0, 0, 0.2, 1) both;
        animation-delay: calc(
          var(--pretui-morph-dur, 0.32s) + var(--pretui-morph-i, 0) *
            var(--pretui-morph-step, 0.012s)
        );
      }
      @keyframes pretui-morph-in {
        from {
          font-size: 0;
          opacity: 0;
          translate: 0 0.35em;
        }
      }
      .pretui-morph-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      /* Reduced motion lands on the END STATE, which for this component is
         the complete text and nothing else: departing glyphs are already
         collapsed to nothing by their base styles, arriving glyphs are
         already at full size. Never a frozen midpoint. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-morph-cell {
          animation: none;
        }
      }
    </style>
  </template>
}
