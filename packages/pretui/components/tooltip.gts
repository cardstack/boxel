// Pretui — Tooltip: a short description of its trigger, shown on hover and focus.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { listen, listenDocumentCapture } from '../focus';

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
 *   cannot put the attribute there itself. The modifier restores whatever was
 *   there before on teardown, so it composes with a caller's own value.
 * - **Presence.** Hidden state is `visibility: hidden`, not opacity alone, so
 *   the bubble leaves the accessibility tree between reveals. A directly
 *   referenced `aria-describedby` target is still announced while hidden —
 *   that is the accname rule this pattern is built on.
 * - **Dismissible.** Escape hides it, in the capture phase, while it is open.
 * - **Hoverable.** `pointer-events` are live and a transparent bridge spans
 *   the 6px gap, so the pointer can travel from trigger to bubble.
 *
 * The reveal is state-driven rather than pure CSS because Escape needs a
 * dismissed flag; the state is only ever written from event handlers, never
 * during render.
 */
export class Tooltip extends Component<TooltipSignature> {
  @tracked private hovered = false;
  @tracked private focused = false;
  @tracked private dismissed = false;
  tipId = `${guidFor(this)}-tip`;
  get side() {
    return this.args.side ?? 'top';
  }
  get shown() {
    return (this.hovered || this.focused) && !this.dismissed;
  }
  /** Wires the tip onto the yielded trigger and puts it back on teardown. */
  describeTrigger = modifier(
    (el: HTMLElement, [id, labels]: [string, boolean | undefined]) => {
      let attr = labels ? 'aria-labelledby' : 'aria-describedby';
      let trigger =
        Array.from(el.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR)).find(
          (candidate) => candidate.id !== id,
        ) ?? (el.firstElementChild as HTMLElement | null);
      if (!trigger || trigger.id === id) return;
      let previous = trigger.getAttribute(attr);
      trigger.setAttribute(attr, previous ? `${previous} ${id}` : id);
      return () => {
        if (previous === null) {
          trigger.removeAttribute(attr);
        } else {
          trigger.setAttribute(attr, previous);
        }
      };
    },
  );
  onEnter = () => {
    this.hovered = true;
  };
  onLeave = () => {
    this.hovered = false;
    this.dismissed = false;
  };
  onFocusIn = () => {
    this.focused = true;
  };
  onFocusOut = () => {
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
      {{listen 'focusin' this.onFocusIn}}
      {{listen 'focusout' this.onFocusOut}}
      ...attributes
    >
      {{yield}}
      <span
        role='tooltip'
        id={{this.tipId}}
        class='pretui-tooltip'
        data-side={{this.side}}
        data-open={{if this.shown 'true'}}
      >{{@content}}</span>
      {{#if this.shown}}
        <span
          class='pretui-tip-key'
          {{listenDocumentCapture 'keydown' this.onKey}}
        ></span>
      {{/if}}
    </span>
    <style scoped>
      .pretui-tipwrap {
        position: relative;
        display: inline-flex;
      }
      .pretui-tip-key {
        display: none;
      }
      .pretui-tooltip {
        position: absolute;
        /* kit stacking scale (pretui-css.gts): a tooltip describes whatever
           is under the pointer, which may be an item inside a dropdown or a
           popover, so it is the highest non-modal tier. */
        z-index: var(--pretui-z-tooltip, 80);
        background: var(--tooltip, var(--boxel-dark));
        color: var(--tooltip-foreground, var(--boxel-light));
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 6px;
        box-shadow: 0 4px 14px var(--shadow-ink-strong, rgb(0 0 0 / 0.16));
        white-space: nowrap;
        width: max-content;
        opacity: 0;
        /* `visibility`, not opacity alone: an opacity-0 bubble is still in
           the accessibility tree and still hit-testable. Hidden here means
           hidden to everyone — while a DIRECT aria-describedby reference
           still resolves its text, which is the whole point. */
        visibility: hidden;
        transition: opacity 120ms ease, visibility 0s linear 120ms;
      }
      .pretui-tooltip[data-open='true'] {
        opacity: 1;
        visibility: visible;
        transition: opacity 120ms ease, visibility 0s;
      }
      /* WCAG 1.4.13 "Hoverable": the pointer must be able to travel onto the
         bubble without it vanishing. The gap between trigger and bubble is
         bridged by a transparent extension of the bubble's own box. */
      .pretui-tooltip::before {
        content: '';
        position: absolute;
        inset: -6px;
      }
      .pretui-tooltip[data-side='top'] {
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
      }
      .pretui-tooltip[data-side='bottom'] {
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
      }
      .pretui-tooltip[data-side='left'] {
        right: calc(100% + 6px);
        top: 50%;
        transform: translateY(-50%);
      }
      .pretui-tooltip[data-side='right'] {
        left: calc(100% + 6px);
        top: 50%;
        transform: translateY(-50%);
      }
    </style>
  </template>
}
