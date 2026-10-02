// Pretui — TextShimmer: a light sweep across text that marks it as in progress.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

// ── TextShimmer ──────────────────────────────────────────────────────────
// Gradient sheen sweeping across text — pure CSS transcription of
// motion-primitives' text-shimmer.tsx: the text is painted by
// background-clip: text over two stacked layers (a no-repeat sheen
// gradient above a solid base-color layer) and the sheen's
// background-position animates 100% → 0% on a linear infinite loop. The
// upstream dark: utility fork is dropped — base and sheen ride the Pretui
// token channel (muted-foreground → foreground), so a season recompile
// re-dresses the sweep. Sheen width follows upstream: text length × @spread
// pixels. Reduced motion shows the base color as plain text.
export interface TextShimmerSignature {
  Args: {
    text: string;
    /** seconds per sweep */
    duration?: number;
    /** sheen half-width in px per character of text */
    spread?: number;
  };
  Element: HTMLSpanElement;
}

export class TextShimmer extends Component<TextShimmerSignature> {
  get style(): ReturnType<typeof htmlSafe> {
    let duration = this.args.duration ?? 2;
    if (!(duration > 0)) duration = 2;
    let spread = (this.args.text ?? '').length * (this.args.spread ?? 2);
    return htmlSafe(
      `--pretui-shimmer-duration: ${duration.toFixed(3)}s; --pretui-shimmer-spread: ${spread.toFixed(1)}px`,
    );
  }
  <template>
    <span
      class='pretui-shimmer'
      style={{this.style}}
      data-test-pretui-text-shimmer
      ...attributes
    >{{@text}}</span>
    <style scoped>
      @layer PretComponent {
        @keyframes pretui-shimmer-sweep {
          from {
            background-position:
              100% center,
              0 0;
          }
          to {
            background-position:
              0% center,
              0 0;
          }
        }
        .pretui-shimmer {
          display: inline-block;
          color: transparent;
          background:
            linear-gradient(
              90deg,
              transparent calc(50% - var(--pretui-shimmer-spread, 32px)),
              var(--foreground),
              transparent calc(50% + var(--pretui-shimmer-spread, 32px))
            ),
            linear-gradient(
              var(--muted-foreground),
              var(--muted-foreground)
            );
          background-size:
            250% 100%,
            auto;
          background-repeat: no-repeat, repeat;
          -webkit-background-clip: text;
          background-clip: text;
          animation: pretui-shimmer-sweep var(--pretui-shimmer-duration, 2s)
            linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-shimmer {
            animation: none;
            background: none;
            color: var(--muted-foreground);
          }
        }
      }
    </style>
  </template>
}
