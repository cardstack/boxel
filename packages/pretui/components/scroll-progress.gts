// Pretui — ScrollProgress: a reading-progress ribbon bound to scroll position.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { cssNumber } from '../pretui-css';

// ── scrollProgress (modifier) + ScrollProgress ───────────────────────────
// Reading-progress ribbon bound to scroll position.
//
// Ported from motion-primitives' <ScrollProgress>, which subscribes to
// framer-motion's useScroll — a scroll listener feeding a spring on every
// frame — and renders a bare <div> with no role, no label, and no
// reduced-motion consideration.
//
// Better than the inspiration: the default path is a pure CSS scroll-driven
// animation (`animation-timeline: scroll()`), which runs off the main thread
// entirely — no listener, no frame loop, no jank while the page is busy.
// Where scroll timelines are unavailable, or where the caller opts into
// announcing progress, the modifier installs a *passive scroll listener*
// (an event listener, not a timer) and writes the ratio into the same custom
// property the CSS path animates, so exactly one set of styles serves both.
//
// Accessibility, which upstream skips entirely: a reading ribbon is chrome —
// the scroll container already reports position to assistive tech, and a
// second, unlabelled progressbar is noise. So the default is
// `aria-hidden='true'` by deliberate choice, documented here rather than by
// omission. Callers who genuinely need it announced pass @label with
// @announce, which switches on `role='progressbar'` with a live
// `aria-valuenow` — and necessarily switches to the listener path, because a
// CSS scroll timeline's position is not observable from script.
//
// Dropped upstream surface: `springOptions` (a spring lag between the
// scrollbar and the ribbon makes the readout wrong; a progress indicator is
// a direct readout, not an animation) and the container-ref prop (@source
// resolves the scroller from the DOM instead).
function nearestScroller(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    // Declared overflow, not current overflow: the modifier installs before
    // the sibling content that will make the box scroll, so measuring
    // scrollHeight here would walk straight past the intended scroller.
    let overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * Degradation + announcement path for `<ScrollProgress />`. No-ops (leaving
 * the CSS scroll timeline in charge) when scroll-driven animations are
 * supported and nothing needs announcing.
 */
export const scrollProgress = modifier(
  (el: HTMLElement, [source, announce]: ['page' | 'nearest', boolean]) => {
    let cssDriven =
      !announce &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline', 'scroll()');
    if (cssDriven) return;
    el.setAttribute('data-js', 'true');
    let scroller =
      source === 'nearest'
        ? nearestScroller(el)
        : ((document.scrollingElement as HTMLElement) ??
          document.documentElement);
    let target: EventTarget =
      scroller === document.scrollingElement ||
      scroller === document.documentElement
        ? window
        : scroller;
    let update = () => {
      let max = scroller.scrollHeight - scroller.clientHeight;
      let ratio = max > 0 ? scroller.scrollTop / max : 0;
      ratio = Math.min(Math.max(ratio, 0), 1);
      el.style.setProperty('--pretui-scroll-progress', ratio.toFixed(4));
      if (announce) {
        el.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      }
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  },
);

export interface ScrollProgressSignature {
  Args: {
    /** 'page' (default) tracks the document; 'nearest' tracks the closest scrolling ancestor — the ribbon must live inside it */
    source?: 'page' | 'nearest';
    /** ribbon thickness in px */
    thickness?: number;
    /** show the unfilled remainder as a track (default true) — this is what makes the component legible in a still frame */
    track?: boolean;
    /** 'none' (default) leaves placement to the caller; 'top' / 'bottom' stick the ribbon to that edge of its scroll container */
    affix?: 'none' | 'top' | 'bottom';
    /** accessible name — required when @announce is true */
    label?: string;
    /** expose the ribbon as a live progressbar to assistive tech. Off by default: see the a11y note in the source. Forces the scroll-listener path. */
    announce?: boolean;
  };
  Element: HTMLDivElement;
}

export class ScrollProgress extends Component<ScrollProgressSignature> {
  get source(): 'page' | 'nearest' {
    return this.args.source ?? 'page';
  }
  get announce(): boolean {
    return this.args.announce ?? false;
  }
  get hidden(): 'true' | undefined {
    return this.announce ? undefined : 'true';
  }
  get role(): string | undefined {
    return this.announce ? 'progressbar' : undefined;
  }
  get affix(): string {
    return this.args.affix ?? 'none';
  }
  get showTrack(): boolean {
    return this.args.track ?? true;
  }
  get style(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    {
      let n = cssNumber(this.args.thickness, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-scrollprogress-thickness: ${n}px`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-scrollprogress'
      data-source={{this.source}}
      data-affix={{this.affix}}
      data-track={{if this.showTrack 'true' 'false'}}
      style={{this.style}}
      role={{this.role}}
      aria-hidden={{this.hidden}}
      aria-label={{if this.announce @label}}
      aria-valuemin={{if this.announce '0'}}
      aria-valuemax={{if this.announce '100'}}
      data-test-pretui-scroll-progress
      {{scrollProgress this.source this.announce}}
      ...attributes
    >
      <span class='pretui-scrollprogress-fill'></span>
    </div>
    <style scoped>
      .pretui-scrollprogress {
        position: relative;
        overflow: hidden;
        height: var(--pretui-scrollprogress-thickness, 3px);
        border-radius: var(--pretui-scrollprogress-radius, 999px);
      }
      .pretui-scrollprogress[data-track='true'] {
        background: var(
          --pretui-scrollprogress-track,
          color-mix(in oklch, var(--foreground) 10%, transparent)
        );
      }
      .pretui-scrollprogress[data-affix='top'] {
        position: sticky;
        inset-block-start: 0;
        z-index: 2;
      }
      .pretui-scrollprogress[data-affix='bottom'] {
        position: sticky;
        inset-block-end: 0;
        z-index: 2;
      }
      .pretui-scrollprogress-fill {
        position: absolute;
        inset: 0;
        transform-origin: left center;
        transform: scaleX(var(--pretui-scroll-progress, 0));
        border-radius: inherit;
        background: var(--pretui-scrollprogress-fill, var(--primary));
      }
      @keyframes pretui-scrollprogress-grow {
        from {
          transform: scaleX(0);
        }
        to {
          transform: scaleX(1);
        }
      }
      /* The preferred path: the compositor drives this off the scroll
         timeline, so it never touches the main thread. [data-js] is written
         by the modifier only when it has taken over. Order matters — the
         `animation` shorthand resets animation-timeline, so the timeline
         longhand has to come after it. */
      @supports (animation-timeline: scroll()) {
        .pretui-scrollprogress[data-source='page']:not([data-js])
          .pretui-scrollprogress-fill {
          animation: pretui-scrollprogress-grow linear both;
          animation-timeline: scroll(root block);
        }
        .pretui-scrollprogress[data-source='nearest']:not([data-js])
          .pretui-scrollprogress-fill {
          animation: pretui-scrollprogress-grow linear both;
          animation-timeline: scroll(nearest block);
        }
      }
      /* No reduced-motion branch by design: the ribbon is a 1:1 readout of
         scroll position with no easing, no lag and no independent movement,
         so there is nothing for prefers-reduced-motion to reduce. */
    </style>
  </template>
}
