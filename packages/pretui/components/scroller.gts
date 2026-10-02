// Pretui — Scroller: a scroll container with edge fades or shadows that show more content is there.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

// ── Scroller ─────────────────────────────────────────────────────────────

export type ScrollerOrientation = 'horizontal' | 'vertical' | 'both';
export type ScrollerEdge = 'fade' | 'shadow' | 'none';

/**
 * Maintains the four edge facts as DATA ATTRIBUTES on the viewport, and
 * makes the viewport keyboard-reachable exactly when it actually scrolls.
 *
 * Written as attributes rather than tracked state on purpose: a scroll
 * listener that writes tracked state re-renders the component on every
 * frame of a flick. These attributes are read only by CSS, so the whole
 * affordance costs one `setAttribute` and no render at all.
 *
 * `tabindex` is managed here too. A scroll container that a mouse user can
 * reach and a keyboard user cannot is a keyboard trap in reverse — the
 * content is simply unreachable. Chromium and Firefox have started making
 * scrollers focusable natively; this keeps the guarantee everywhere, and
 * REMOVES the tab stop again when the content shrinks and no longer
 * overflows, which is the part native focusable-scrollers gets right and
 * hand-rolled `tabindex='0'` does not.
 */
const scrollEdges = modifier(
  (element: HTMLElement, [orientation]: [ScrollerOrientation]) => {
    let update = () => {
      let horizontal = orientation !== 'vertical';
      let vertical = orientation !== 'horizontal';
      // 1px of slack: sub-pixel layout means scrollLeft rarely reaches
      // exactly scrollWidth - clientWidth, and a permanently-visible "there
      // is more" fade at a hard stop is a lie.
      let overflowX = element.scrollWidth - element.clientWidth > 1;
      let overflowY = element.scrollHeight - element.clientHeight > 1;
      let left = Math.abs(element.scrollLeft);
      element.dataset['startX'] =
        horizontal && overflowX && left > 1 ? 'clipped' : 'flush';
      element.dataset['endX'] =
        horizontal && overflowX && left < element.scrollWidth - element.clientWidth - 1
          ? 'clipped'
          : 'flush';
      element.dataset['startY'] =
        vertical && overflowY && element.scrollTop > 1 ? 'clipped' : 'flush';
      element.dataset['endY'] =
        vertical &&
        overflowY &&
        element.scrollTop < element.scrollHeight - element.clientHeight - 1
          ? 'clipped'
          : 'flush';

      let scrollable = (horizontal && overflowX) || (vertical && overflowY);
      if (scrollable) {
        if (element.getAttribute('tabindex') === null) {
          element.setAttribute('tabindex', '0');
        }
      } else if (element.getAttribute('tabindex') === '0') {
        element.removeAttribute('tabindex');
      }
    };

    element.addEventListener('scroll', update, { passive: true });
    // Content can change size without a scroll ever happening — a lazy image
    // landing, a season swap changing the type scale. Observing the viewport
    // AND its content covers both directions.
    let observer = new ResizeObserver(update);
    observer.observe(element);
    for (let child of Array.from(element.children)) {
      observer.observe(child);
    }
    update();

    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  },
);

export interface ScrollerSignature {
  Args: {
    /** Which axes may scroll. Default `horizontal`. */
    orientation?: ScrollerOrientation;
    /** Accessible name. Supplying one promotes the viewport to a landmark
     * `region`, which is what makes it findable by rotor — without a name a
     * region is noise, so the role is not applied unless it is named. */
    label?: string;
    /** Edge treatment: a `fade` (default), an inset `shadow`, or `none`. */
    edge?: ScrollerEdge;
    /** Hide the native scrollbar. The edge affordance stays — which is the
     * whole reason hiding it is defensible at all. */
    hideScrollbar?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * A scroll container that says when it is clipped.
 *
 * ```hbs
 * <Scroller @label='Recent lots' @orientation='horizontal'>
 *   <div class='row'>…</div>
 * </Scroller>
 * ```
 *
 * Better than the inspiration (`wa-scroller`): upstream ships one shadow
 * treatment, both axes always on, and no notion of whether the region is
 * reachable by keyboard. Here the axis is explicit, the treatment is a knob,
 * the tab stop appears and DISAPPEARS with the overflow, and the affordance
 * is driven by data attributes rather than by re-rendering on every scroll
 * frame.
 */
export class Scroller extends Component<ScrollerSignature> {
  get orientation(): ScrollerOrientation {
    return this.args.orientation ?? 'horizontal';
  }
  get edge(): ScrollerEdge {
    return this.args.edge ?? 'fade';
  }
  get role(): string | undefined {
    return this.args.label ? 'region' : undefined;
  }

  <template>
    <div
      class='pretui-scroller'
      data-test-pretui-scroller
      data-edge={{this.edge}}
      ...attributes
    >
      <div
        class='pretui-scroller-viewport'
        data-orientation={{this.orientation}}
        data-hide-scrollbar={{if @hideScrollbar 'true'}}
        role={{this.role}}
        aria-label={{@label}}
        data-test-pretui-scroller-viewport
        {{scrollEdges this.orientation}}
      >
        {{yield}}
      </div>
      {{! Four overlays rather than a mask on the viewport: a mask would fade
          the scrollbar too. Sibling combinators off the viewport's data
          attributes drive them, so no state round-trips through Glimmer. }}
      <span class='pretui-scroller-edge' data-side='start-x' aria-hidden='true'></span>
      <span class='pretui-scroller-edge' data-side='end-x' aria-hidden='true'></span>
      <span class='pretui-scroller-edge' data-side='start-y' aria-hidden='true'></span>
      <span class='pretui-scroller-edge' data-side='end-y' aria-hidden='true'></span>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-scroller {
          position: relative;
          display: block;
          min-width: 0;
          container-type: inline-size;
        }
        .pretui-scroller-viewport {
          min-width: 0;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-gutter: stable;
        }
        .pretui-scroller-viewport:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: var(--radius-surface, 10px);
        }
        .pretui-scroller-viewport[data-orientation='horizontal'] {
          overflow-x: auto;
          overflow-y: hidden;
        }
        .pretui-scroller-viewport[data-orientation='vertical'] {
          overflow-x: hidden;
          overflow-y: auto;
        }
        .pretui-scroller-viewport[data-orientation='both'] {
          overflow: auto;
        }
        .pretui-scroller-viewport[data-hide-scrollbar='true'] {
          scrollbar-width: none;
        }
        .pretui-scroller-edge {
          position: absolute;
          opacity: 0;
          pointer-events: none;
          /* An opacity fade is not motion that encodes a state change so much
             as a state change that would otherwise pop; it stays short and it
             is cut entirely under reduced motion. */
          transition: opacity 140ms linear;
        }
        .pretui-scroller-edge[data-side='start-x'],
        .pretui-scroller-edge[data-side='end-x'] {
          inset-block: 0;
          inline-size: var(--pretui-scroller-fade, 28px);
        }
        .pretui-scroller-edge[data-side='start-x'] {
          inset-inline-start: 0;
        }
        .pretui-scroller-edge[data-side='end-x'] {
          inset-inline-end: 0;
        }
        .pretui-scroller-edge[data-side='start-y'],
        .pretui-scroller-edge[data-side='end-y'] {
          inset-inline: 0;
          block-size: var(--pretui-scroller-fade, 28px);
        }
        .pretui-scroller-edge[data-side='start-y'] {
          inset-block-start: 0;
        }
        .pretui-scroller-edge[data-side='end-y'] {
          inset-block-end: 0;
        }
        /* Sibling combinators off the viewport's own attributes: the state
           never round-trips through Glimmer, so a flick costs no renders. */
        .pretui-scroller-viewport[data-start-x='clipped'] ~ .pretui-scroller-edge[data-side='start-x'],
        .pretui-scroller-viewport[data-end-x='clipped'] ~ .pretui-scroller-edge[data-side='end-x'],
        .pretui-scroller-viewport[data-start-y='clipped'] ~ .pretui-scroller-edge[data-side='start-y'],
        .pretui-scroller-viewport[data-end-y='clipped'] ~ .pretui-scroller-edge[data-side='end-y'] {
          opacity: 1;
        }
        .pretui-scroller[data-edge='none'] .pretui-scroller-edge {
          display: none;
        }
        .pretui-scroller[data-edge='fade'] .pretui-scroller-edge[data-side='start-x'] {
          background: linear-gradient(
            to right,
            var(--pretui-scroller-ground, var(--card)),
            transparent
          );
        }
        .pretui-scroller[data-edge='fade'] .pretui-scroller-edge[data-side='end-x'] {
          background: linear-gradient(
            to left,
            var(--pretui-scroller-ground, var(--card)),
            transparent
          );
        }
        .pretui-scroller[data-edge='fade'] .pretui-scroller-edge[data-side='start-y'] {
          background: linear-gradient(
            to bottom,
            var(--pretui-scroller-ground, var(--card)),
            transparent
          );
        }
        .pretui-scroller[data-edge='fade'] .pretui-scroller-edge[data-side='end-y'] {
          background: linear-gradient(
            to top,
            var(--pretui-scroller-ground, var(--card)),
            transparent
          );
        }
        .pretui-scroller[data-edge='shadow'] .pretui-scroller-edge[data-side='start-x'] {
          background: linear-gradient(
            to right,
            color-mix(in oklch, var(--foreground) 14%, transparent),
            transparent
          );
        }
        .pretui-scroller[data-edge='shadow'] .pretui-scroller-edge[data-side='end-x'] {
          background: linear-gradient(
            to left,
            color-mix(in oklch, var(--foreground) 14%, transparent),
            transparent
          );
        }
        .pretui-scroller[data-edge='shadow'] .pretui-scroller-edge[data-side='start-y'] {
          background: linear-gradient(
            to bottom,
            color-mix(in oklch, var(--foreground) 14%, transparent),
            transparent
          );
        }
        .pretui-scroller[data-edge='shadow'] .pretui-scroller-edge[data-side='end-y'] {
          background: linear-gradient(
            to top,
            color-mix(in oklch, var(--foreground) 14%, transparent),
            transparent
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-scroller-edge {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
