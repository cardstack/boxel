// Pretui — TextScramble: text that resolves out of deterministic glyph noise.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { pick, seedFrom } from '../examples';

// ── TextScramble ─────────────────────────────────────────────────────────
// Letters resolve out of noise — CSS-drivable approximation of
// motion-primitives' text-scramble.tsx, with the delta on record: the
// original runs a setInterval that re-randomizes every unresolved char
// each ~40ms tick (Math.random per frame) while a progress line sweeps
// left to right. Neither timers nor Math.random exist in realm code, and
// the tempting pure-CSS alternative — a per-character steps() animation
// cycling a glyph strip through ::before content — is not feasible
// (content can't tween through a strip under the scoped-css transpile).
// The transcription keeps the left-to-right resolve and the churn
// *impression*: each char is a stack of two seeded noise glyphs (FNV-1a
// pick off the text itself, so the same text scrambles identically every
// render) that hand off mid-window and then blur/fade out as the real
// char blurs in, on staggered delays. Total choreography spans @duration:
// half stagger sweep, half per-char resolve window.
const SCRAMBLE_GLYPHS = [
  '#',
  '%',
  '&',
  '+',
  '=',
  '*',
  '<',
  '>',
  '/',
  '?',
  '$',
  '@',
  '!',
  '§',
  '¤',
  '~',
];

export interface TextScrambleSignature {
  Args: {
    text: string;
    /** total seconds from first noise to last resolved character */
    duration?: number;
  };
  Element: HTMLSpanElement;
}

interface ScrambleCell {
  ch: string;
  space: boolean;
  noiseA: string;
  noiseB: string;
  style: ReturnType<typeof htmlSafe> | null;
}

export class TextScramble extends Component<TextScrambleSignature> {
  get duration(): number {
    let d = this.args.duration ?? 0.8;
    return d > 0 ? d : 0.8;
  }
  get containerStyle(): ReturnType<typeof htmlSafe> {
    return htmlSafe(
      `--pretui-scramble-window: ${(this.duration / 2).toFixed(3)}s`,
    );
  }
  get cells(): ScrambleCell[] {
    let text = this.args.text ?? '';
    let chars = Array.from(text);
    let seed = seedFrom(text);
    let sweep = this.duration / 2;
    let last = Math.max(chars.length - 1, 1);
    return chars.map((ch, i) => {
      if (ch === ' ') {
        return { ch, space: true, noiseA: '', noiseB: '', style: null };
      }
      return {
        ch,
        space: false,
        noiseA: pick(seed, 2 * i, SCRAMBLE_GLYPHS),
        noiseB: pick(seed, 2 * i + 1, SCRAMBLE_GLYPHS),
        style: htmlSafe(
          `--pretui-scr-delay: ${((i * sweep) / last).toFixed(3)}s`,
        ),
      };
    });
  }
  <template>
    <span
      class='pretui-scramble'
      style={{this.containerStyle}}
      data-test-pretui-text-scramble
      ...attributes
    >
      <span aria-hidden='true'>
        {{#each this.cells as |c|}}{{#if c.space}}<span class='pretui-scramble-space'>{{c.ch}}</span>{{else}}<span class='pretui-scramble-cell' style={{c.style}}><span class='pretui-scramble-real'>{{c.ch}}</span><span class='pretui-scramble-noise pretui-scramble-noise-a'>{{c.noiseA}}</span><span class='pretui-scramble-noise pretui-scramble-noise-b'>{{c.noiseB}}</span></span>{{/if}}{{/each}}
      </span>
      <span class='pretui-sr'>{{@text}}</span>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-scramble {
          display: inline-block;
        }
        .pretui-scramble-space {
          white-space: pre;
        }
        .pretui-scramble-cell {
          position: relative;
          display: inline-block;
        }
        /* base styles are the resolved end state; keyframes choreograph */
        .pretui-scramble-real {
          animation: pretui-scr-real var(--pretui-scramble-window, 0.4s) linear
            both;
          animation-delay: var(--pretui-scr-delay, 0s);
        }
        @keyframes pretui-scr-real {
          0%,
          60% {
            opacity: 0;
            filter: blur(3px);
          }
          100% {
            opacity: 1;
            filter: blur(0);
          }
        }
        .pretui-scramble-noise {
          position: absolute;
          inset: 0;
          text-align: center;
          color: var(--muted-foreground);
          opacity: 0;
          pointer-events: none;
        }
        .pretui-scramble-noise-a {
          animation: pretui-scr-noise-a var(--pretui-scramble-window, 0.4s)
            linear both;
          animation-delay: var(--pretui-scr-delay, 0s);
        }
        @keyframes pretui-scr-noise-a {
          0%,
          40% {
            opacity: 1;
            filter: blur(0);
          }
          55%,
          100% {
            opacity: 0;
            filter: blur(2px);
          }
        }
        .pretui-scramble-noise-b {
          animation: pretui-scr-noise-b var(--pretui-scramble-window, 0.4s)
            linear both;
          animation-delay: var(--pretui-scr-delay, 0s);
        }
        @keyframes pretui-scr-noise-b {
          0%,
          40% {
            opacity: 0;
          }
          50%,
          72% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            filter: blur(2px);
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-scramble-real,
          .pretui-scramble-noise {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
