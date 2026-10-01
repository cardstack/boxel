// Pretui — Typewriter: text that types itself in, character by character.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

// ── Typewriter ───────────────────────────────────────────────────────────
// Character-by-character reveal — the static-choreography sibling of
// StreamingText (reading.gts): StreamingText paces live agent output that
// arrives word-by-word; Typewriter choreographs a string it already holds.
// Timer-law transcription notes (vs fancy-components' typewriter.tsx,
// which drives a setTimeout state machine):
//   - Each char span carries `--pretui-type-i` and the container carries
//     `--pretui-type-step: 1/@speed s`; the reveal is
//     `animation-delay: calc(index * var(--step))` with a steps(1) snap —
//     no interval ticks.
//   - Unrevealed chars animate from font-size: 0, so the line grows as it
//     "types" and the caret rides the insertion point instead of parking
//     at the end of an invisible full-width line.
//   - No @loop / delete-and-retype cycle: a coherent CSS loop of a
//     staggered per-char reveal needs per-index keyframe percentages
//     (every char must share one period), which static scoped CSS cannot
//     express — so the upstream waitTime/deleteSpeed/loop surface is
//     deliberately out of scope. Re-render the component to replay.
export interface TypewriterSignature {
  Args: {
    text: string;
    /** reveal rate in characters per second (Law 7: unitless rate) */
    speed?: number;
    /** blinking insertion-point caret */
    caret?: boolean;
    /** seconds before the first character lands */
    startDelay?: number;
  };
  Element: HTMLSpanElement;
}

export class Typewriter extends Component<TypewriterSignature> {
  get containerStyle(): ReturnType<typeof htmlSafe> {
    let speed = this.args.speed ?? 16;
    if (!(speed > 0)) speed = 16;
    let delay = this.args.startDelay ?? 0;
    return htmlSafe(
      `--pretui-type-step: ${(1 / speed).toFixed(4)}s; --pretui-type-delay: ${delay.toFixed(3)}s`,
    );
  }
  get chars(): { ch: string; style: ReturnType<typeof htmlSafe> }[] {
    return Array.from(this.args.text ?? '').map((ch, i) => ({
      ch,
      style: htmlSafe(`--pretui-type-i: ${i}`),
    }));
  }
  <template>
    <span
      class='pretui-type'
      style={{this.containerStyle}}
      data-test-pretui-typewriter
      ...attributes
    >
      <span aria-hidden='true'>
        {{#each this.chars as |c|}}<span class='pretui-type-char' style={{c.style}}>{{c.ch}}</span>{{/each}}{{#if @caret}}<span class='pretui-type-caret'></span>{{/if}}
      </span>
      <span class='pretui-sr'>{{@text}}</span>
    </span>
    <style scoped>
      .pretui-type {
        display: inline;
      }
      @keyframes pretui-type-char-in {
        from {
          font-size: 0;
          opacity: 0;
        }
        to {
          font-size: 1em;
          opacity: 1;
        }
      }
      .pretui-type-char {
        white-space: pre;
        animation: pretui-type-char-in 1ms steps(1, end) both;
        animation-delay: calc(
          var(--pretui-type-delay, 0s) +
            var(--pretui-type-i, 0) * var(--pretui-type-step, 0.0625s)
        );
      }
      @keyframes pretui-type-caret-blink {
        0%,
        49% {
          opacity: 1;
        }
        50%,
        100% {
          opacity: 0;
        }
      }
      .pretui-type-caret {
        display: inline-block;
        width: 0.5ch;
        height: 1em;
        vertical-align: -0.12em;
        margin-left: 1px;
        border-radius: 1px;
        background: currentColor;
        animation: pretui-type-caret-blink 1.06s steps(1, end) infinite;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-type-char,
        .pretui-type-caret {
          animation: none;
        }
      }
    </style>
  </template>
}
