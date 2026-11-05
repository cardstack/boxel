// Pretui — Tooltip: a short description of its trigger, shown on hover and focus.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { listen, listenDocumentCapture } from '../focus';
import { positionPopup } from '../internal/overlay';

// The trigger-to-bubble gap in px, for the measuring code; the bridge in CSS
// spans the same distance as --_tip-gap.
const TIP_GAP = 6;

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
      let open = el.matches(':popover-open');
      let anchor = el.parentElement;
      if (!shown || !anchor) {
        if (open) el.hidePopover();
        return;
      }
      if (!open) el.showPopover();
      let place = () => {
        let r = el.getBoundingClientRect();
        let p = positionPopup(
          anchor.getBoundingClientRect(),
          r.width,
          r.height,
          side,
          TIP_GAP,
        );
        el.style.top = `${p.top}px`;
        el.style.left = `${p.left}px`;
      };
      place();
      window.addEventListener('scroll', place, { capture: true, passive: true });
      window.addEventListener('resize', place);
      return () => {
        window.removeEventListener('scroll', place, true);
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
    if (!this.shown) return;
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.stopPropagation();
    this.dismissed = true;
  };
  <template>
    <span
      class='pretui-tipwrap'
      data-test-pretui-tooltip
      {{this.describeTrigger this.tipId @labels}}
      {{listen 'mouseenter' this.onEnter}}
      {{listen 'mouseleave' this.onLeave}}
      {{listen 'mousedown' this.onPress}}
      {{listen 'focusin' this.onFocusIn}}
      {{listen 'focusout' this.onFocusOut}}
      ...attributes
    >
      {{yield}}
      <span
        role='tooltip'
        id={{this.tipId}}
        class='pretui-tooltip'
        popover='manual'
        data-side={{this.side}}
        data-open={{if this.shown 'true'}}
        {{this.showTip this.shown this.side}}
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
          /* the space between trigger and bubble, which the bridge spans */
          --_tip-gap: 0.375rem;
          /* a manual popover: the top layer is above every z-index, and the
             show modifier writes top and left */
          position: fixed;
          inset: auto;
          margin: 0;
          border: 0;
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
          /* display and overlay hold the bubble in the top layer until the
             fade-out ends */
          transition:
            opacity 120ms ease,
            display 120ms allow-discrete,
            overlay 120ms allow-discrete;
        }
        .pretui-tooltip:popover-open {
          opacity: 1;
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
