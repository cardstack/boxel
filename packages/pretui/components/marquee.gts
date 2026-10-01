// Pretui — Marquee: a continuously scrolling strip that pauses on hover and reduced motion.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

// ── Marquee — TRANSCRIBED from fancy SimpleMarquee ───────────────────────
// The original runs a useAnimationFrame loop over motion values with
// scroll-velocity coupling, drag inertia, hover slowdown springs, and a
// configurable easing function. This transcription keeps the one job —
// a seamless drifting strip — as a pure CSS keyframe loop (TIMER LAW):
// content is rendered twice (second copy aria-hidden), the track
// translates 0 → -50%, and the loop is seamless because each copy carries
// its own trailing gap (--pretui-marquee-gap rides INSIDE the copy, so
// half the track is exactly one copy). @speed is honest px/s: a modifier
// measures one copy's width (ResizeObserver, disconnected on cleanup —
// measurement only, never a timer) and sets duration = width / speed.
// Skipped from the original, deliberately: scroll-velocity direction
// coupling, drag/inertia, easing functions, vertical directions, repeat
// count (fixed at 2), and hover SLOWDOWN — @pauseOnHover pauses outright
// via animation-play-state instead. Reduced motion: the animation is
// removed and the strip becomes a static overflow-x row (mask lifted so
// the edges are honest scroll edges).

export interface MarqueeSignature {
  Args: {
    /** drift speed in px/s — default 60 */
    speed?: number;
    /** 'left' (default) drifts content leftward */
    direction?: 'left' | 'right';
    /** pause the loop while the pointer is over the strip */
    pauseOnHover?: boolean;
  };
  Blocks: {
    /** strip content — rendered twice for the seamless loop */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Marquee extends Component<MarqueeSignature> {
  get direction(): 'left' | 'right' {
    return this.args.direction ?? 'left';
  }
  // Measures one copy (half the track) and converts @speed px/s into the
  // CSS animation duration. ResizeObserver re-measures when content
  // reflows; it is disconnected in the modifier's cleanup.
  trackSpeed = modifier((track: HTMLElement, [speed]: [number | undefined]) => {
    let apply = () => {
      let half = track.scrollWidth / 2;
      let pxPerSecond = Math.max(1, speed ?? 60);
      track.style.setProperty(
        '--pretui-marquee-duration',
        `${Math.max(0.5, half / pxPerSecond).toFixed(2)}s`,
      );
    };
    apply();
    let observer = new ResizeObserver(apply);
    observer.observe(track);
    return () => observer.disconnect();
  });
  <template>
    <div
      class='pretui-marquee'
      data-direction={{this.direction}}
      data-pause-on-hover={{if @pauseOnHover 'true'}}
      data-test-pretui-marquee
      ...attributes
    >
      <div class='pretui-marquee-track' {{this.trackSpeed @speed}}>
        <div class='pretui-marquee-copy'>{{yield}}</div>
        <div class='pretui-marquee-copy' aria-hidden='true'>{{yield}}</div>
      </div>
    </div>
    <style scoped>
      .pretui-marquee {
        overflow: hidden;
        -webkit-mask-image: linear-gradient(
          to right,
          transparent,
          #000 8%,
          #000 92%,
          transparent
        );
        mask-image: linear-gradient(
          to right,
          transparent,
          #000 8%,
          #000 92%,
          transparent
        );
      }
      .pretui-marquee-track {
        display: flex;
        width: max-content;
        min-width: 100%;
        animation: pretui-marquee-drift
          var(--pretui-marquee-duration, 20s)
          linear
          infinite;
      }
      .pretui-marquee[data-direction='right'] .pretui-marquee-track {
        animation-direction: reverse;
      }
      .pretui-marquee[data-pause-on-hover='true']:hover
        .pretui-marquee-track {
        animation-play-state: paused;
      }
      /* Each copy carries the inter-item gap AND a matching trailing gap,
         so copy width includes its seam spacing and -50% lands exactly on
         the second copy's start. */
      .pretui-marquee-copy {
        display: flex;
        flex: none;
        min-width: 50%;
        align-items: center;
        gap: var(--pretui-marquee-gap, var(--space-5, 16px));
        padding-inline-end: var(--pretui-marquee-gap, var(--space-5, 16px));
      }
      @keyframes pretui-marquee-drift {
        from {
          transform: translateX(0);
        }
        to {
          transform: translateX(-50%);
        }
      }
      /* Static overflow row: no loop, honest scroll edges (mask lifted). */
      @media (prefers-reduced-motion: reduce) {
        .pretui-marquee {
          overflow-x: auto;
          -webkit-mask-image: none;
          mask-image: none;
        }
        .pretui-marquee-track {
          animation: none;
        }
      }
    </style>
  </template>
}
