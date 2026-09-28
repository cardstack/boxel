// Pretui — SlidingHighlight: the travelling selection indicator and the modifier that measures it.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { cssNumber } from '../pretui-css';
import { seconds } from '../internal/motion-core';

// ── slidingHighlight (modifier) + SlidingHighlight (indicator) ───────────
// Law 5's second canonical mechanism: ONE absolutely-positioned indicator
// whose translate/width follow the active item's offsetLeft/offsetWidth with
// a transition, so the selection TRAVELS instead of cross-fading. The
// travel is what encodes "selection moved from there to here" — the reader
// would otherwise have to infer it.
//
// This is deliberately split in two so adoption by an existing control is a
// five-line diff and no component has to hand its DOM over:
//   {{slidingHighlight}}   on the item container — measures, writes custom
//                          properties, and nothing else
//   <SlidingHighlight />   inside it — the indicator that reads them
// Custom properties inherit across scoped-CSS boundaries, which is precisely
// why the geometry travels as custom properties rather than as classes.
//
// Better than the inspiration (radix/headlessui indicators and the
// react-bits animated tabs): the container does not have to declare which
// item is active. A MutationObserver watches data-state / aria-selected /
// aria-current, so the modifier takes no arguments in the common case and
// stays correct when selection is driven by anything at all — including the
// browser, via :checked-driven attributes. Upstream indicators need the
// active index threaded through props and a useEffect to re-measure.
//
// Also handled, which upstream typically is not:
//   - the first-paint slide from (0,0) is suppressed without a timer, by
//     writing a 0s duration into the SAME style mutation as the first
//     geometry (transitions read the after-change style, so nothing runs)
//   - a ResizeObserver keeps the geometry honest through font loading and
//     container resize
//   - reduced motion parks the indicator on the active item instantly — the
//     END state, never a frozen midpoint
const ACTIVE_SELECTOR =
  '[data-state="active"], [aria-selected="true"], [aria-current="true"], [aria-current="page"]';

/**
 * Measures the active descendant of the element it is installed on and
 * publishes `--pretui-highlight-x/y/w/h/on` for a `<SlidingHighlight />`
 * rendered inside. Takes no arguments in the common case; pass a custom
 * active-item selector when the container also holds selectable content that
 * the default selector would reach — `':scope > [aria-selected=\"true\"]'`
 * confines it to direct children.
 */
export const slidingHighlight = modifier(
  (el: HTMLElement, [selector]: [(string | undefined)?]) => {
    let sel = selector ?? ACTIVE_SELECTOR;
    // The indicator is absolutely positioned; give it a containing block if
    // the container has not already claimed one.
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
    let first = true;
    let watched: HTMLElement | null = null;
    let resize: ResizeObserver | null = null;
    let measure = () => {
      let active = el.querySelector<HTMLElement>(sel);
      if (!active) {
        el.style.setProperty('--pretui-highlight-on', '0');
        return;
      }
      let x: number;
      let y: number;
      let w: number;
      let h: number;
      if (active.offsetParent === el) {
        x = active.offsetLeft;
        y = active.offsetTop;
        w = active.offsetWidth;
        h = active.offsetHeight;
      } else {
        let a = active.getBoundingClientRect();
        let c = el.getBoundingClientRect();
        x = a.left - c.left + el.scrollLeft;
        y = a.top - c.top + el.scrollTop;
        w = a.width;
        h = a.height;
      }
      if (watched !== active) {
        if (resize && watched) resize.unobserve(watched);
        if (resize) resize.observe(active);
        watched = active;
      }
      let style = el.style;
      style.setProperty('--pretui-highlight-x', `${x.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-y', `${y.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-w', `${w.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-h', `${h.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-on', '1');
      // First measurement lands with a 0s duration in the same mutation, so
      // the indicator appears in place instead of sliding in from the
      // origin. Clearing the property afterwards restores the real duration.
      style.setProperty('--pretui-highlight-init', first ? '0s' : '');
      first = false;
    };
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(() => measure());
    }
    measure();
    resize?.observe(el);
    let mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => measure());
    // 'style' is deliberately absent from the filter: the modifier writes to
    // el.style itself, and watching it would feed back into this observer.
    mutation?.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-selected', 'aria-current'],
    });
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
    };
  },
);

export interface SlidingHighlightSignature {
  Args: {
    /** pill (default, a raised card face) | underline | soft (accent tint) | outline */
    variant?: 'pill' | 'underline' | 'soft' | 'outline';
    /** travel duration in seconds */
    duration?: number;
    /** bar thickness in px — the underline variant only */
    thickness?: number;
    /** corner radius in px; defaults to the control radius, or 1px under underline */
    radius?: number;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * The travelling indicator. Render it inside a container carrying
 * `{{slidingHighlight}}`; it needs no arguments to work. Its block is a slot
 * for callers who want to paint the indicator themselves (a gradient, a
 * texture) while keeping the travel.
 */
export class SlidingHighlight extends Component<SlidingHighlightSignature> {
  get variant(): string {
    return this.args.variant ?? 'pill';
  }
  get style(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    if (this.args.duration !== undefined) {
      bits.push(
        `--pretui-highlight-duration: ${seconds(this.args.duration, 0.22)}`,
      );
    }
    {
      let n = cssNumber(this.args.thickness, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-highlight-thickness: ${n}px`);
      }
    }
    {
      let n = cssNumber(this.args.radius, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-highlight-radius: ${n}px`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <span
      class='pretui-highlight'
      data-variant={{this.variant}}
      style={{this.style}}
      aria-hidden='true'
      data-test-pretui-sliding-highlight
      ...attributes
    >{{yield}}</span>
    <style scoped>
      .pretui-highlight {
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        width: var(--pretui-highlight-w, 0px);
        height: var(--pretui-highlight-h, 0px);
        transform: translate(
          var(--pretui-highlight-x, 0px),
          var(--pretui-highlight-y, 0px)
        );
        opacity: var(--pretui-highlight-on, 0);
        border-radius: var(--pretui-highlight-radius, var(--radius));
        pointer-events: none;
        z-index: 0;
        transition-property: transform, width, height, opacity;
        /* --init is present only for the first measurement (see the
           modifier); the chain then falls through to the caller's duration,
           then to the kit's snap default. */
        transition-duration: var(
          --pretui-highlight-init,
          var(--pretui-highlight-duration, var(--pretui-dur-snap, 180ms))
        );
        transition-timing-function: var(
          --pretui-highlight-ease,
          var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1))
        );
      }
      .pretui-highlight[data-variant='pill'] {
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border),
          0 1px 2px rgb(16 24 40 / 0.1)
        );
      }
      .pretui-highlight[data-variant='soft'] {
        background: color-mix(
          in oklch,
          var(--primary) 14%,
          var(--card)
        );
      }
      .pretui-highlight[data-variant='outline'] {
        box-shadow: 0 0 0 1px var(--primary);
      }
      .pretui-highlight[data-variant='underline'] {
        height: var(--pretui-highlight-thickness, 2px);
        border-radius: var(--pretui-highlight-radius, 1px);
        background: var(--primary);
        /* ride the bottom edge of the active item's box */
        transform: translate(
          var(--pretui-highlight-x, 0px),
          calc(
            var(--pretui-highlight-y, 0px) + var(--pretui-highlight-h, 0px) -
              var(--pretui-highlight-thickness, 2px)
          )
        );
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-highlight {
          transition-property: none;
        }
      }
    </style>
  </template>
}
