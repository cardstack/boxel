// Pretui — LoadingState: a pixel-grid loader with a shimmer label and caller-supplied elapsed text.
import Component from '@glimmer/component';
import { keepStyle, type KeptProperty } from '../internal/keep-style';

export interface LoadingStateSignature {
  Args: {
    label?: string;
    variant?: 'drive' | 'dots' | 'orbit';
    // caller-supplied elapsed text ("4.2s") — realm components own no timers
    elapsed?: string;
  };
  Element: HTMLSpanElement;
}

// Adopted from Beautiful UI: pixel-grid loader + shimmer label (+ elapsed).
export class LoadingState extends Component<LoadingStateSignature> {
  get label() {
    return this.args.label ?? 'Working';
  }
  get variant() {
    return this.args.variant ?? 'drive';
  }
  // Each lit pixel's delay is written through the CSSOM rather than a
  // `style` attribute, which a strict Content Security Policy refuses. The
  // variant's duration and the unlit pixels come from the stylesheet.
  get pixels(): { kept: KeptProperty[]; idle: boolean }[] {
    let chev = Array.from({ length: 9 }, (_, i) => {
      let r = Math.floor(i / 3);
      let c = i % 3;
      return (c + Math.abs(r - 1)) * 90;
    });
    let order = [0, 1, 2, 5, 8, 7, 6, 3];
    let orbit = Array.from({ length: 9 }, (_, i) => {
      let k = order.indexOf(i);
      return k === -1 ? null : k * 110;
    });
    let delays = this.variant === 'orbit' ? orbit : chev;
    return delays.map((d) => ({
      idle: d === null,
      kept:
        d === null
          ? []
          : [
              {
                property: '--pretui-pixel-delay',
                value: `${d}ms`,
                strength: 'arg',
              },
            ],
    }));
  }
  <template>
    <span class='pretui-loading' role='status' data-test-pretui-loading-state ...attributes>
      <span aria-hidden='true' class='pretui-pixelgrid' data-variant={{this.variant}}>
        {{#each this.pixels as |p|}}
          <span class='pretui-pixel' data-idle={{if p.idle 'true'}} {{keepStyle p.kept}}></span>
        {{/each}}
      </span>
      <span class='pretui-shimmer-label'>{{this.label}}</span>
      {{#if @elapsed}}<span class='pretui-elapsed'>{{@elapsed}}</span>{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        @keyframes pretui-pixel-on {
          0%,
          100% {
            opacity: 0.15;
          }
          50% {
            opacity: 1;
          }
        }
        @keyframes pretui-shimmer-text {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
        .pretui-loading {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .pretui-pixelgrid {
          display: grid;
          grid-template-columns: repeat(3, 4px);
          gap: 1.5px;
        }
        .pretui-pixel {
          width: 4px;
          height: 4px;
          background: var(--foreground);
          border-radius: 1px;
          opacity: 0.15;
          animation: pretui-pixel-on 650ms ease-in-out var(--pretui-pixel-delay, 0ms) infinite;
        }
        .pretui-pixelgrid[data-variant='orbit'] .pretui-pixel {
          animation-duration: 950ms;
        }
        .pretui-pixelgrid[data-variant='dots'] .pretui-pixel {
          border-radius: 50%;
        }
        .pretui-pixel[data-idle] {
          opacity: 0.07;
          animation: none;
        }
        .pretui-shimmer-label {
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 500;
          background-image: linear-gradient(90deg, var(--ink-3, var(--boxel-400)) 35%, var(--foreground) 50%, var(--ink-3, var(--boxel-400)) 65%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: pretui-shimmer-text 1.4s linear infinite;
          white-space: nowrap;
        }
        .pretui-elapsed {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--ink-3, var(--boxel-400));
          font-variant-numeric: tabular-nums;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-pixel {
            animation: none !important;
            opacity: 0.6;
          }
          .pretui-shimmer-label {
            animation: none;
            color: var(--muted-foreground);
            background: none;
          }
        }
      }
    </style>
  </template>
}
