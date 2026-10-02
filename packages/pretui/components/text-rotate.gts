// Pretui — TextRotate: a word slot that cycles through a list of words.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

// ── TextRotate ───────────────────────────────────────────────────────────
// Rotating word slot — transcription of fancy-components' text-rotate.tsx
// reduced to its CSS-expressible core: a clipped one-line slot over a
// vertical reel of words, advanced by one keyframe animation running
// translateY(0 → -N lines) with steps(N, end) over N × @interval seconds,
// infinite. The step count and duration ride inline style (keyframe
// percentages can't be parameterized, but steps() count and duration can),
// and the first word repeats at the reel's tail so the 100% frame wraps
// seamlessly. Dropped upstream surface: the motion/react enter-exit slide,
// per-char stagger, and splitBy modes — steps() swaps words discretely,
// which is the honest timer-free reading of a "word slot". Reduced motion
// pins the reel to the first word.
export interface TextRotateSignature {
  Args: {
    words: string[];
    /** seconds each word holds the slot */
    interval?: number;
  };
  Element: HTMLSpanElement;
}

export class TextRotate extends Component<TextRotateSignature> {
  get words(): string[] {
    return (this.args.words ?? []).filter((w) => w.length > 0);
  }
  get canRotate(): boolean {
    return this.words.length > 1;
  }
  get firstWord(): string {
    return this.words[0] ?? '';
  }
  // reel = words + repeated first word, so the wrap frame lands on a twin
  get reel(): string[] {
    return [...this.words, this.firstWord];
  }
  get srText(): string {
    return this.words.join(', ');
  }
  get reelStyle(): ReturnType<typeof htmlSafe> {
    let n = this.words.length;
    let interval = this.args.interval ?? 2;
    if (!(interval > 0)) interval = 2;
    return htmlSafe(
      `--pretui-rotate-count: ${n}; animation-duration: ${(n * interval).toFixed(2)}s; animation-timing-function: steps(${n}, end)`,
    );
  }
  <template>
    <span class='pretui-rotate' data-test-pretui-text-rotate ...attributes>
      {{#if this.canRotate}}
        <span class='pretui-rotate-mask' aria-hidden='true'>
          <span class='pretui-rotate-reel' style={{this.reelStyle}}>
            {{#each this.reel as |word|}}
              <span class='pretui-rotate-word'>{{word}}</span>
            {{/each}}
          </span>
        </span>
        <span class='pretui-sr'>{{this.srText}}</span>
      {{else}}
        {{this.firstWord}}
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-rotate {
          display: inline-block;
        }
        .pretui-rotate-mask {
          display: inline-block;
          overflow: hidden;
          height: var(--pretui-rotate-line, 1.4em);
          /* overflow != visible turns the inline-block baseline into its
             bottom edge; -0.4em reseats the inner baseline (0.2em
             half-leading + ~0.2em descender) on the surrounding line —
             empirical, override --pretui-rotate-line to retune */
          vertical-align: -0.4em;
        }
        .pretui-rotate-reel {
          display: flex;
          flex-direction: column;
          animation-name: pretui-rotate-step;
          animation-iteration-count: infinite;
          /* duration + steps(N, end) arrive via inline style */
        }
        .pretui-rotate-word {
          height: var(--pretui-rotate-line, 1.4em);
          line-height: var(--pretui-rotate-line, 1.4em);
          white-space: nowrap;
        }
        @keyframes pretui-rotate-step {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(
              calc(
                var(--pretui-rotate-count, 1) * -1 *
                  var(--pretui-rotate-line, 1.4em)
              )
            );
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
          .pretui-rotate-reel {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
