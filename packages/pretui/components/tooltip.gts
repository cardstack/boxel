// Pretui — Tooltip: a short description of its trigger, shown on hover and focus.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { listen, listenDocumentCapture } from '../focus';
import { positionPopup } from '../internal/overlay';

// The trigger-to-bubble gap. The show modifier places the bubble this far
// out and sets --_tip-gap to it, so the bridge in CSS spans exactly the gap
// at any root font size.
const TIP_GAP_REM = 0.375;

// The element a Tooltip describes. The trigger arrives as a caller block, so
// the component finds it rather than receiving it — the first thing in the
// wrapper the keyboard can reach, falling back to the wrapper's first element
// child for a non-focusable trigger (a static badge, a truncated cell).
const TRIGGER_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex], [role]';

export interface TooltipSignature {
  Args: {
    content: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    /**
     * Name the trigger instead of describing it. `aria-describedby` is the
     * APG recommendation and the default here; Web Awesome deliberately ships
     * `aria-labelledby` because several screen readers announce a description
     * inconsistently (or not at all) on a control that already has a name.
     * Set this when the tooltip text IS the control's name — an icon-only
     * button whose only label is its tip.
     */
    labels?: boolean;
    /**
     * Keeps the tip hidden, as while a menu or flyout the trigger opened
     * covers where it would show. The association stays.
     */
    disabled?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * Always-dark (both modes — "the lining").
 *
 * **Rebuilt 2026-08-13.** The previous version carried `role='tooltip'` and
 * nothing else: no id, no `aria-describedby`, and the bubble sat in the DOM
 * permanently with only `opacity` animated — so its text was read as ambient
 * page content next to every trigger, forever, and no assistive technology
 * could tell it apart from the trigger's own content. It also failed two of
 * WCAG 1.4.13's three conditions: not dismissible (no Escape) and not
 * hoverable (`pointer-events: none`, so a magnified reader could never move
 * onto the bubble).
 *
 * What it does now:
 *
 * - **Association.** The bubble gets a generated id and a modifier wires
 *   `aria-describedby` (or `aria-labelledby` with `@labels`) onto the first
 *   focusable descendant — the trigger is a caller block, so the component
 *   cannot put the attribute there itself. It appends its id to a caller's
 *   own value, keeps it there when the caller's value changes, and removes
 *   only its id on teardown.
 * - **Presence.** The bubble is a manual popover: hidden, it is
 *   `display: none`, so it is out of the accessibility tree and takes no
 *   space in any scroll container; shown, it sits in the top layer, placed
 *   against the wrapper, where no `overflow` ancestor clips it. A directly
 *   referenced `aria-describedby` target is still announced while hidden —
 *   that is the accname rule this pattern is built on.
 * - **Dismissible.** Escape hides it, in the capture phase, while it is open.
 * - **Keyboard focus only.** Focus from a mouse press doesn't open it, so a
 *   clicked trigger doesn't keep its tip up after the pointer leaves.
 * - **Hoverable.** `pointer-events` are live and a transparent bridge spans
 *   the gap, so the pointer can travel from trigger to bubble.
 *
 * The reveal is state-driven rather than pure CSS because Escape needs a
 * dismissed flag; the state is only ever written from event handlers, never
 * during render.
 */
export class Tooltip extends Component<TooltipSignature> {
  @tracked private hovered = false;
  @tracked private focused = false;
  @tracked private dismissed = false;
  private pressed = false;
  // False while the open tip is hidden because its trigger is out of view.
  private inView = true;
  tipId = `${guidFor(this)}-tip`;
  get side() {
    return this.args.side ?? 'top';
  }
  get shown() {
    return (
      (this.hovered || this.focused) && !this.dismissed && !this.args.disabled
    );
  }
  /** Wires the tip onto the yielded trigger and takes it off on teardown. */
  describeTrigger = modifier(
    (el: HTMLElement, [id, labels]: [string, boolean | undefined]) => {
      let attr = labels ? 'aria-labelledby' : 'aria-describedby';
      let trigger =
        Array.from(el.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR)).find(
          (candidate) => candidate.id !== id,
        ) ?? (el.firstElementChild as HTMLElement | null);
      if (!trigger || trigger.id === id) return;
      let target = trigger;
      let ids = () =>
        (target.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);
      let addId = () => {
        let current = ids();
        if (!current.includes(id)) {
          target.setAttribute(attr, [...current, id].join(' '));
        }
      };
      addId();
      // The caller can rewrite the attribute after insert (a bound value that
      // changes), which would drop the tip's id; put it back each time.
      let observer = new MutationObserver(addId);
      observer.observe(target, { attributeFilter: [attr] });
      return () => {
        observer.disconnect();
        let rest = ids().filter((token) => token !== id);
        if (rest.length) {
          target.setAttribute(attr, rest.join(' '));
        } else {
          target.removeAttribute(attr);
        }
      };
    },
  );
  /** Shows the bubble in the top layer and keeps it on the wrapper. */
  showTip = modifier(
    (
      el: HTMLElement,
      [shown, side]: [boolean, 'top' | 'bottom' | 'left' | 'right'],
    ) => {
      let anchor = el.parentElement;
      if (!shown || !anchor) {
        // data-side is the side the tip prefers until it opens, then the
        // side it opened on, which a flip can change.
        el.dataset['side'] = side;
        if (el.matches(':popover-open')) el.hidePopover();
        return;
      }
      if (!el.matches(':popover-open')) {
        // A trigger is in view when it opens its tip; the observer below
        // hides the bubble again if it isn't.
        this.inView = true;
        el.style.visibility = '';
        el.showPopover();
      }
      el.style.setProperty('--_tip-gap', `${TIP_GAP_REM}rem`);
      let gap =
        TIP_GAP_REM *
        parseFloat(getComputedStyle(document.documentElement).fontSize);
      let place = () => {
        let r = el.getBoundingClientRect();
        let p = positionPopup(
          anchor.getBoundingClientRect(),
          r.width,
          r.height,
          side,
          gap,
        );
        el.style.top = `${p.top}px`;
        el.style.left = `${p.left}px`;
        el.dataset['side'] = p.side;
      };
      place();
      // Placed again when the bubble or its trigger changes size, as with new
      // @content. Moving the trigger in the DOM closes the popover without an
      // event and takes focus off the trigger, which not every browser
      // reports; the bubble's size changes with it, and the tip then closes
      // as if dismissed.
      let sizes = new ResizeObserver(() => {
        if (el.matches(':popover-open')) {
          place();
        } else {
          this.focused = false;
          this.dismissed = true;
        }
      });
      sizes.observe(el);
      sizes.observe(anchor);
      // The top layer escapes the trigger's clipping containers, so the
      // bubble hides itself while the trigger is scrolled or clipped away.
      let clip = new IntersectionObserver((entries) => {
        let entry = entries[entries.length - 1];
        if (!entry) return;
        this.inView = entry.isIntersecting;
        el.style.visibility = this.inView ? '' : 'hidden';
      });
      clip.observe(anchor);
      // Only a scroll that can move the trigger moves the bubble. The target
      // isn't checked with `instanceof Node`, which is false in some hosts
      // (the realm test harness among them).
      let onScroll = (e: Event) => {
        let target = e.target as Node | null;
        if (target?.contains && !target.contains(anchor)) return;
        place();
      };
      window.addEventListener('scroll', onScroll, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', place);
      return () => {
        sizes.disconnect();
        clip.disconnect();
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', place);
      };
    },
  );
  onEnter = () => {
    this.hovered = true;
  };
  onLeave = () => {
    this.pressed = false;
    this.hovered = false;
    this.dismissed = false;
  };
  // A click focuses the trigger too, but only keyboard focus opens the tip:
  // otherwise it would stay up after the pointer leaves, until focus moves.
  onPress = () => {
    this.pressed = true;
    this.focused = false;
  };
  onFocusIn = () => {
    // Keyboard focus starts fresh, even when no focusout cleared an earlier
    // dismissal (as when the trigger moved in the DOM). A click's focus
    // doesn't, so it never undoes an Escape.
    if (!this.pressed) this.dismissed = false;
    this.focused = !this.pressed;
    this.pressed = false;
  };
  onFocusOut = () => {
    this.pressed = false;
    this.focused = false;
    this.dismissed = false;
  };
  // WCAG 1.4.13 "Dismissible". Capture phase + stopPropagation so one Escape
  // means exactly one thing — hide THIS tip — and never also closes the
  // dialog the trigger happens to live in.
  onKey = (e: Event) => {
    // A tip hidden with its out-of-view trigger leaves Escape to the page.
    if (!this.shown || !this.inView) return;
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.stopPropagation();
    this.dismissed = true;
  };
  <template>
    <span
      class='pretui-tipwrap'
      {{this.describeTrigger this.tipId @labels}}
      {{listen 'mouseenter' this.onEnter}}
      {{listen 'mouseleave' this.onLeave}}
      {{listen 'mousedown' this.onPress}}
      {{listen 'focusin' this.onFocusIn}}
      {{listen 'focusout' this.onFocusOut}}
      data-test-pretui-tooltip
      ...attributes
    >
      {{yield}}
      <span
        role='tooltip'
        id={{this.tipId}}
        class='pretui-tooltip'
        popover='manual'
        data-open={{if this.shown 'true'}}
        {{this.showTip this.shown this.side}}
        data-test-pretui-tooltip-bubble
      >{{@content}}</span>
      {{#if this.shown}}
        <span
          class='pretui-tip-key'
          {{listenDocumentCapture 'keydown' this.onKey}}
        ></span>
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-tipwrap {
          display: inline-flex;
        }
        .pretui-tip-key {
          display: none;
        }
        .pretui-tooltip {
          /* a manual popover: the top layer is above every z-index, and the
             show modifier writes top, left and --_tip-gap, the space the
             bridge spans */
          position: fixed;
          inset: auto;
          margin: 0;
          border: 0;
          /* the bubble's edge in forced-colors mode, which drops its shadow;
             an outline, unlike a border, leaves the bridge's box alone */
          outline: 1px solid transparent;
          overflow: visible;
          background-color: var(--tooltip);
          color: var(--tooltip-foreground);
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          box-shadow: var(--shadow-lg);
          white-space: nowrap;
          width: max-content;
          opacity: 0;
          --_tip-fade: 120ms;
          transition: opacity var(--_tip-fade) ease;
        }
        /* display and overlay hold the bubble in the top layer until the
           fade-out ends. A browser that can't transition overlay would drop
           it from the top layer as the fade began, so there it closes at
           once. */
        @supports (overlay: auto) {
          .pretui-tooltip {
            transition:
              opacity var(--_tip-fade) ease,
              display var(--_tip-fade) allow-discrete,
              overlay var(--_tip-fade) allow-discrete;
          }
        }
        .pretui-tooltip:popover-open {
          opacity: 1;
        }
        /* fading out, it no longer takes the pointer */
        .pretui-tooltip:not(:popover-open) {
          pointer-events: none;
        }
        @starting-style {
          .pretui-tooltip:popover-open {
            opacity: 0;
          }
        }
        /* WCAG 1.4.13 "Hoverable": the pointer must be able to travel onto the
           bubble without it vanishing. The gap between trigger and bubble is
           bridged by a transparent extension of the bubble's own box. */
        .pretui-tooltip::before {
          content: '';
          position: absolute;
          inset: calc(-1 * var(--_tip-gap));
        }
      }
    </style>
  </template>
}
