// Pretui — TextEffects: per-character, word or line entrances for a line of text.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { seedFrom } from '../examples';

// ═══════════════════════════════════════════════════════════════════════
// TextEffects
// ═══════════════════════════════════════════════════════════════════════

/** The entrance treatments. Each is a state transition from "absent" to
 * "present" drawn a different way; none of them loops. */
export type TextEffectPreset =
  | 'fade'
  | 'blur'
  | 'rise'
  | 'fall'
  | 'scale'
  | 'slide'
  | 'unmask';

/** What gets its own animation. `word` is the default because a per-CHARACTER
 * stagger on a long paragraph reads as a novelty and takes forever; per-line
 * is the right grain for body copy. */
export type TextEffectPer = 'char' | 'word' | 'line';

/** The sequence the stagger runs in. */
export type TextEffectOrder =
  | 'forward'
  | 'reverse'
  | 'centre'
  | 'edges'
  | 'shuffle';

/**
 * Which stagger SLOT each unit occupies — the whole choreography, as pure
 * arithmetic over indices.
 *
 * Exported and unit-testable because "does `centre` really start in the
 * middle" is a question about a number sequence, not about a browser. The
 * `shuffle` order is seeded rather than random: `Math.random()` is forbidden
 * in a realm (it makes indexing non-deterministic), and a seeded shuffle is
 * better anyway — the same string always dances the same way, so a
 * screenshot is reproducible.
 */
export function staggerOrder(
  count: number,
  order: TextEffectOrder = 'forward',
  seed = 0,
): number[] {
  if (count <= 0) {
    return [];
  }
  let slots: number[] = [];
  if (order === 'reverse') {
    for (let i = 0; i < count; i++) {
      slots.push(count - 1 - i);
    }
    return slots;
  }
  if (order === 'centre' || order === 'edges') {
    let middle = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      let fromMiddle = Math.round(Math.abs(i - middle));
      slots.push(order === 'centre' ? fromMiddle : Math.ceil(middle) - fromMiddle);
    }
    return slots;
  }
  if (order === 'shuffle') {
    // Fisher–Yates driven by a Lehmer generator seeded from the caller's
    // seed, so it is a permutation (every slot used exactly once) rather
    // than the hash-per-index approach, which collides.
    let state = (seed % 2147483646) + 1;
    let next = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      slots.push(i);
    }
    for (let i = count - 1; i > 0; i--) {
      let j = Math.floor(next() * (i + 1));
      let swap = slots[i] as number;
      slots[i] = slots[j] as number;
      slots[j] = swap;
    }
    return slots;
  }
  for (let i = 0; i < count; i++) {
    slots.push(i);
  }
  return slots;
}

/**
 * Split a string into animatable units, keeping the whitespace.
 *
 * Whitespace is kept AS units rather than trimmed away because a word
 * stagger that drops its spaces re-joins the text wrongly, and because a
 * space that animates alongside its word is what makes the line grow
 * smoothly instead of reflowing at the end.
 */
export function splitUnits(text: string, per: TextEffectPer): string[] {
  let source = text ?? '';
  if (source.length === 0) {
    return [];
  }
  if (per === 'char') {
    return Array.from(source);
  }
  if (per === 'line') {
    return source.split(/\n/);
  }
  return source.split(/(\s+)/).filter((unit) => unit.length > 0);
}

interface EffectUnit {
  key: string;
  text: string;
  blank: boolean;
  style: ReturnType<typeof htmlSafe>;
}

export interface TextEffectsSignature {
  Args: {
    /** the string to reveal. Mirrored in full in an sr-only span, so the
     * chopped-up animated copy stays `aria-hidden`. */
    text: string;
    /** which entrance (default 'fade') */
    effect?: TextEffectPreset;
    /** the unit that gets its own animation (default 'word') */
    per?: TextEffectPer;
    /** the sequence the stagger runs in (default 'forward') */
    order?: TextEffectOrder;
    /** seconds between one unit starting and the next (default 0.04) */
    stagger?: number;
    /** seconds one unit takes (default 0.5). Separate from `@stagger`
     * because they read differently and Law 7 says every knob is separately
     * settable — most libraries ship one `speed` and stop. */
    duration?: number;
    /** seconds before the first unit moves (default 0) */
    delay?: number;
    /** travel in px for rise / fall / slide (default 14) */
    distance?: number;
    /** blur radius in px for the blur preset (default 8) */
    blur?: number;
  };
  Element: HTMLSpanElement;
}

export class TextEffects extends Component<TextEffectsSignature> {
  private positive(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  }
  get effect(): TextEffectPreset {
    return this.args.effect ?? 'fade';
  }
  get per(): TextEffectPer {
    return this.args.per ?? 'word';
  }
  get containerStyle(): ReturnType<typeof htmlSafe> {
    let duration = this.positive(this.args.duration, 0.5);
    let stagger = this.args.stagger;
    let step =
      stagger !== undefined && Number.isFinite(stagger) && stagger >= 0
        ? stagger
        : 0.04;
    let delay = this.args.delay;
    let lead = delay !== undefined && Number.isFinite(delay) && delay >= 0 ? delay : 0;
    let distance = this.positive(this.args.distance, 14);
    let blur = this.positive(this.args.blur, 8);
    // Every value here is a NUMBER put through toFixed — a number cannot
    // carry a semicolon, so this needs no cssValue guard. Caller STRINGS
    // never reach this style attribute.
    return htmlSafe(
      '--pretui-fx-dur: ' +
        duration.toFixed(3) +
        's; --pretui-fx-step: ' +
        step.toFixed(3) +
        's; --pretui-fx-delay: ' +
        lead.toFixed(3) +
        's; --pretui-fx-dist: ' +
        distance.toFixed(2) +
        'px; --pretui-fx-blur: ' +
        blur.toFixed(2) +
        'px',
    );
  }
  get units(): EffectUnit[] {
    let text = this.args.text ?? '';
    let parts = splitUnits(text, this.per);
    let slots = staggerOrder(parts.length, this.args.order ?? 'forward', seedFrom(text));
    return parts.map((unit, index) => ({
      key: index + ':' + unit,
      text: unit,
      blank: unit.trim().length === 0,
      style: htmlSafe('--pretui-fx-i: ' + String(slots[index] ?? index)),
    }));
  }
  <template>
    <span
      class='pretui-fx'
      style={{this.containerStyle}}
      data-effect={{this.effect}}
      data-per={{this.per}}
      data-test-pretui-text-effects
      ...attributes
    >
      <span aria-hidden='true' class='pretui-fx-stack'>
        {{~#each this.units key='key' as |unit|~}}
          <span
            class='pretui-fx-unit'
            data-blank={{if unit.blank 'true'}}
            style={{unit.style}}
          >{{unit.text}}</span>
        {{~/each~}}
      </span>
      <span class='pretui-fx-sr'>{{@text}}</span>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-fx {
          display: inline;
        }
        .pretui-fx[data-per='line'] .pretui-fx-stack {
          display: block;
          white-space: pre-wrap;
        }
        .pretui-fx[data-per='line'] .pretui-fx-unit {
          display: block;
        }
        /* Base styles ARE the end state — every keyframe animates TOWARD
           these values, never away from them. That is what makes
           animation:none a correct reduced-motion fallback with nothing
           restated. */
        .pretui-fx-unit {
          display: inline-block;
          white-space: pre;
          opacity: 1;
          filter: none;
          translate: none;
          scale: 1;
          animation-name: pretui-fx-fade;
          animation-duration: var(--pretui-fx-dur, 0.5s);
          animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
          animation-fill-mode: both;
          animation-delay: calc(
            var(--pretui-fx-delay, 0s) + var(--pretui-fx-i, 0) *
              var(--pretui-fx-step, 0.04s)
          );
        }
        /* A run of spaces has nothing to reveal; animating it only makes the
           line reflow while the words arrive. */
        .pretui-fx-unit[data-blank='true'] {
          animation-name: none;
        }
        @keyframes pretui-fx-fade {
          from {
            opacity: 0;
          }
        }
        @keyframes pretui-fx-blur {
          from {
            opacity: 0;
            filter: blur(var(--pretui-fx-blur, 8px));
          }
        }
        @keyframes pretui-fx-rise {
          from {
            opacity: 0;
            translate: 0 var(--pretui-fx-dist, 14px);
          }
        }
        @keyframes pretui-fx-fall {
          from {
            opacity: 0;
            translate: 0 calc(-1 * var(--pretui-fx-dist, 14px));
          }
        }
        @keyframes pretui-fx-scale {
          from {
            opacity: 0;
            scale: 0.7;
          }
        }
        @keyframes pretui-fx-slide {
          from {
            opacity: 0;
            translate: calc(-1 * var(--pretui-fx-dist, 14px)) 0;
          }
        }
        /* The one preset that is not a fade: the glyph is already opaque and
           is uncovered from below, so the text reads as being revealed by
           something rather than materialising out of nothing. */
        @keyframes pretui-fx-unmask {
          from {
            clip-path: inset(0 0 100% 0);
            translate: 0 calc(0.35 * var(--pretui-fx-dist, 14px));
          }
        }
        .pretui-fx[data-effect='blur'] .pretui-fx-unit {
          animation-name: pretui-fx-blur;
        }
        .pretui-fx[data-effect='rise'] .pretui-fx-unit {
          animation-name: pretui-fx-rise;
        }
        .pretui-fx[data-effect='fall'] .pretui-fx-unit {
          animation-name: pretui-fx-fall;
        }
        .pretui-fx[data-effect='scale'] .pretui-fx-unit {
          animation-name: pretui-fx-scale;
        }
        .pretui-fx[data-effect='slide'] .pretui-fx-unit {
          animation-name: pretui-fx-slide;
        }
        .pretui-fx[data-effect='unmask'] .pretui-fx-unit {
          animation-name: pretui-fx-unmask;
        }
        .pretui-fx[data-effect='unmask'] .pretui-fx-unit {
          clip-path: inset(0 0 0 0);
        }
        .pretui-fx-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-fx-unit {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
