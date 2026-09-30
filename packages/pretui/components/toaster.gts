// Pretui — Toaster: the toast HOST the kit never had.
//
// `Toast` in feedback.gts is presentation-only — one card, no stack, no
// queue, no lifecycle. Law 7 named that hole and the React-ecosystem gap doc
// promoted it to the highest-priority item in the catalogue, because every
// agent trained on Sonner or Mantine Notifications reaches for a `<Toaster />`
// and finds nothing to mount.
//
// ── The realm timer law, and why this component owns no timer ────────────
//
// The hard part of a toaster is auto-dismiss. The obvious implementation is a
// `setTimeout` per toast, cancelled on hover and **re-armed** with the
// remaining time on unhover. That is illegal here twice over: computing
// "remaining time" needs `Date.now()` (forbidden — the indexer requires
// determinism), and a re-arming timer blocks `await settled()` and hangs the
// `boxel test` suite for every agent on the realm.
//
// So the clock is not a timer at all. **It is a CSS animation.** Each toast
// renders a life bar running `pretui-toast-age` for its own duration, and the
// toast is removed on that element's `animationend` — an event listener owned
// by an `ember-modifier` and removed in its destructor. Everything that
// follows falls out of that one decision:
//
//  * **Pause on hover / pause on focus is `animation-play-state: paused`.**
//    Zero JS, and it is *genuinely* a pause — the animation resumes from where
//    it stopped, so no elapsed time has to be measured or re-armed. Sonner and
//    Mantine both keep a wall-clock and subtract; we never need one.
//  * **Pause while the tab is hidden** is the same property, toggled by a
//    `visibilitychange` listener that owns nothing but a boolean.
//  * **Degradation is safe.** Where the animation never runs (the `boxel test`
//    harness delivers no scoped stylesheet at all), `animationend` never fires
//    and a toast simply waits to be dismissed. A toast that overstays is a
//    nuisance; a toast that vanishes early, or a timer that hangs a suite, is
//    a defect.
//
// The one thing this costs: there is **no exit animation**, because holding a
// dismissed toast in the DOM long enough to animate it out would need exactly
// the timer we refused. Removal is immediate; the survivors reflow with a
// transition, which is the part a reader actually notices.
//
// ── What this fixes relative to Sonner / Mantine / Base UI ───────────────
//
//  1. **Overflow is honest.** Sonner keeps every toast alive and shows three,
//     so the invisible ones age out unseen and are gone by the time they would
//     have surfaced. Here the cap is a real queue: toasts past `@limit` are
//     not rendered, so their clock has not started, and the region says how
//     many are waiting. Mantine queues but never tells you.
//  2. **Dismissal never strands focus.** Dismissing the toast you are focused
//     on moves focus to the next toast's dismiss control, and when the last
//     one goes, back to whatever had focus before you entered the region.
//     Sonner drops focus on the body.
//  3. **A keyboard user can reach a toast at all.** F6 moves focus into the
//     region (the hotkey Base UI ships and almost nobody else does), and F6
//     from inside returns it.
//  4. **Severity picks the live-region politeness**, rather than announcing
//     every toast the same way: `role='alert'` for warning/danger,
//     `role='status'` for the rest.
//  5. **The remaining time is a non-colour channel** (Appendix O.14) — the
//     life bar is the only "how long have I got" signal in any of the three.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as menu.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { listenDocument, listenDocumentCapture } from '../focus';

// ── The toast model ──────────────────────────────────────────────────────

/** Severity. Drives the tone tokens AND the live-region politeness. */
export type ToastTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

/**
 * Where the stack lives. Logical `start`/`end` rather than physical
 * `left`/`right` (Appendix axis 8), so RTL is free. The React spellings
 * (`bottom-right`, `top-left`, …) are accepted and mapped.
 */
export type ToastPlacement =
  | 'top-start'
  | 'top'
  | 'top-end'
  | 'bottom-start'
  | 'bottom'
  | 'bottom-end';

const PLACEMENT_ALIASES: Record<string, ToastPlacement> = {
  'top-left': 'top-start',
  'top-center': 'top',
  'top-right': 'top-end',
  'bottom-left': 'bottom-start',
  'bottom-center': 'bottom',
  'bottom-right': 'bottom-end',
};

/** One toast. `id` is assigned by `ToastStore`; a controlled caller supplies
 * its own and is responsible for uniqueness. */
export interface ToastItem {
  id: string;
  title: string;
  /** the second line — optional, because most toasts are one line */
  message?: string;
  tone?: ToastTone;
  /**
   * Seconds before the toast ages out; `0` makes it sticky. Seconds, not ms,
   * per the kit's duration law — Sonner's `duration: 4000` reads as four
   * thousand of something and every caller has to remember which.
   */
  duration?: number;
  /** false removes the dismiss control; the toast then relies on its clock */
  dismissible?: boolean;
  /** label for a single inline action ("Undo") */
  actionLabel?: string;
  onAction?: () => void;
  /** fired when the toast leaves, however it left */
  onDismiss?: () => void;
}

/** What `ToastStore.show` takes: everything but the id, which it assigns. */
export type ToastInput = Omit<ToastItem, 'id'> & { id?: string };

/**
 * The imperative half of the API, as an **instantiable store rather than a
 * module singleton**.
 *
 * `toast('Saved')` from a module-level singleton is what the React corpus
 * expects, and it is exactly what a realm must not ship: module-scope mutable
 * state is evaluated by the indexer, shared across every card that imports it,
 * and impossible to reset between tests. One store per consumer keeps the
 * ergonomics (`this.toasts.show({ title: 'Saved' })`) and loses none of them.
 *
 * Ids come from a monotonic counter — `Math.random()` and `Date.now()` are
 * both forbidden, and a counter is the better answer anyway because it is
 * reproducible.
 */
export class ToastStore {
  @tracked items: readonly ToastItem[] = [];
  private seq = 0;

  /** Adds a toast and returns its id. Passing an existing `id` REPLACES that
   * toast in place, which is how a "Saving…" becomes a "Saved" without the
   * stack jumping. */
  show = (input: ToastInput): string => {
    let id = input.id ?? this.nextFreeId();
    let next: ToastItem = { ...input, id };
    let at = this.items.findIndex((item) => item.id === id);
    if (at >= 0) {
      let copy = this.items.slice();
      copy[at] = next;
      this.items = copy;
    } else {
      this.items = [next, ...this.items];
    }
    return id;
  };

  /** Skips any number a caller-supplied id already holds, so an auto id never
   * replaces someone else's toast. */
  private nextFreeId(): string {
    let id: string;
    do {
      id = 'toast-' + ++this.seq;
    } while (this.items.some((item) => item.id === id));
    return id;
  }

  dismiss = (id: string) => {
    let hit = this.items.find((item) => item.id === id);
    if (!hit) {
      return;
    }
    this.items = this.items.filter((item) => item.id !== id);
    hit.onDismiss?.();
  };

  /** Removes everything, firing each toast's own `onDismiss`. */
  clear = () => {
    let all = this.items;
    this.items = [];
    for (let item of all) {
      item.onDismiss?.();
    }
  };
}

// ── Pure helpers, so the queue rules are testable without a DOM ──────────

/** The toasts that get rendered: newest first, capped at `limit`. */
/**
 * The toasts on screen: the OLDEST `limit`, still newest-first. A toast that
 * has been rendered stays rendered until it is dismissed — its clock is
 * running and it may hold focus — so a new arrival past the cap waits rather
 * than pushing a visible toast out.
 */
export function visibleToasts(
  items: readonly ToastItem[],
  limit: number,
): ToastItem[] {
  let cap = Math.max(0, limit);
  return cap === 0 ? [] : items.slice(Math.max(0, items.length - cap));
}

/** How many are waiting behind the cap. Their clocks have not started —
 * that is the whole point of holding them out of the DOM. */
export function queuedCount(
  items: readonly ToastItem[],
  limit: number,
): number {
  return Math.max(0, items.length - Math.max(0, limit));
}

/**
 * Live-region politeness by severity.
 *
 * `alert` interrupts; `status` waits for a pause. A save confirmation that
 * interrupts what someone is reading is a defect, and a failure that waits
 * politely behind three other announcements is a worse one.
 */
export function toastRole(tone: ToastTone | undefined): 'alert' | 'status' {
  return tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
}

/** The `aria-live` value matching `toastRole`. Stated explicitly rather than
 * left implicit in the role, because several screen readers have historically
 * mapped bare `role='alert'` inconsistently. */
export function toastLive(
  tone: ToastTone | undefined,
): 'assertive' | 'polite' {
  return toastRole(tone) === 'alert' ? 'assertive' : 'polite';
}

/** Normalises the React placement spellings onto the house enum. */
export function resolveToastPlacement(
  value: string | undefined,
): ToastPlacement {
  if (!value) {
    return 'bottom-end';
  }
  return (PLACEMENT_ALIASES[value] ?? value) as ToastPlacement;
}

const FOCUSABLE_IN_TOAST = 'button, a[href], [tabindex]:not([tabindex="-1"])';

export interface ToasterSignature {
  Args: {
    /** the imperative store. Supply this OR @toasts + @onDismiss. */
    store?: ToastStore;
    /** fully controlled list; wins over @store when both are present */
    toasts?: readonly ToastItem[];
    /** required in controlled mode — a host that cannot remove a toast is not
     * controllable, which is the same defect as an overlay with only
     * `@onClose` */
    onDismiss?: (id: string) => void;
    /** where the stack sits (default 'bottom-end') */
    placement?: ToastPlacement;
    /** React alias for @placement */
    position?: string;
    /** how many render at once; the rest queue, unstarted (default 4) */
    limit?: number;
    /** default seconds per toast; a toast's own @duration wins (default 5) */
    duration?: number;
    /** pause every clock while the pointer is over the region (default true) */
    pauseOnHover?: boolean;
    /** pause every clock while focus is inside the region (default true) */
    pauseOnFocus?: boolean;
    /** pause every clock while the tab is hidden (default true) */
    pauseWhenHidden?: boolean;
    /** the region's accessible name (default 'Notifications') */
    label?: string;
    /** accessible name for the dismiss control (default 'Dismiss') */
    dismissLabel?: string;
    /** F6 moves focus into the region and back out (default true) */
    hotkey?: boolean;
  };
  Blocks: {
    /** render-prop escape hatch: draw the toast body yourself. The chrome —
     * region, roles, clock, dismiss, focus handling — stays ours. */
    toast: [ToastItem];
  };
  Element: HTMLElement;
}

export class Toaster extends Component<ToasterSignature> {
  /** Dismiss buttons by toast id, so focus can be handed to a neighbour
   * BEFORE the dismissed toast is torn down. Deliberately not `@tracked`: it
   * is written from inside a modifier body, and a tracked property written
   * where it is also read is a backtracking re-render. */
  private dismissEls = new Map<string, HTMLElement>();
  /** What had focus before it entered the region, so dismissing the last
   * toast can put it back rather than dropping it on the body. */
  private priorFocus: HTMLElement | undefined;
  private regionEl: HTMLElement | undefined;

  @tracked private hidden = false;

  get items(): readonly ToastItem[] {
    return this.args.toasts ?? this.args.store?.items ?? [];
  }
  get limit(): number {
    return this.args.limit ?? 4;
  }
  get visible(): ToastItem[] {
    return visibleToasts(this.items, this.limit);
  }
  get queued(): number {
    return queuedCount(this.items, this.limit);
  }
  get placement(): ToastPlacement {
    return resolveToastPlacement(this.args.placement ?? this.args.position);
  }
  get regionLabel(): string {
    return this.args.label ?? 'Notifications';
  }
  get dismissLabel(): string {
    return this.args.dismissLabel ?? 'Dismiss';
  }
  get pausedAttr(): string | undefined {
    return (this.args.pauseWhenHidden ?? true) && this.hidden
      ? 'true'
      : undefined;
  }
  get pauseHoverAttr(): string | undefined {
    return (this.args.pauseOnHover ?? true) ? 'true' : undefined;
  }
  get pauseFocusAttr(): string | undefined {
    return (this.args.pauseOnFocus ?? true) ? 'true' : undefined;
  }

  // ── Per-toast reads, invoked from the template ────────────────────────

  toneOf = (item: ToastItem): ToastTone => item.tone ?? 'neutral';
  roleOf = (item: ToastItem): string => toastRole(item.tone);
  liveOf = (item: ToastItem): string => toastLive(item.tone);
  isDismissible = (item: ToastItem): boolean => item.dismissible ?? true;

  /** Seconds, resolved against the host default. 0 means sticky. */
  secondsOf = (item: ToastItem): number =>
    item.duration ?? this.args.duration ?? 5;

  hasClock = (item: ToastItem): boolean => this.secondsOf(item) > 0;

  /** The only inline style here, and it carries one clamped number — the
   * animation's own duration. The rest of the toast is tokens. */
  one = (item: ToastItem): ToastItem[] => [item];

  lifeStyle = (item: ToastItem) => {
    let seconds = Math.max(0, Math.min(600, this.secondsOf(item)));
    return htmlSafe('--pretui-toast-life: ' + seconds + 's');
  };

  // ── Removal ──────────────────────────────────────────────────────────

  private remove(id: string) {
    if (this.args.toasts) {
      this.args.onDismiss?.(id);
      return;
    }
    this.args.store?.dismiss(id);
    this.args.onDismiss?.(id);
  }

  /**
   * Dismissal that hands focus on rather than dropping it.
   *
   * The neighbour is resolved and focused BEFORE the removal, while both
   * elements are still in the tree — the neighbour is a keyed `{{#each}}`
   * entry, so it survives the re-render with focus intact. When nothing is
   * left, focus returns to whatever the reader was doing before F6 or Tab
   * brought them here.
   */
  private dismissAndKeepFocus(id: string) {
    let list = this.visible;
    let at = list.findIndex((item) => item.id === id);
    let neighbour = list[at + 1] ?? list[at - 1];
    let target = neighbour ? this.dismissEls.get(neighbour.id) : undefined;
    let hadFocus =
      !!this.regionEl &&
      !!document.activeElement &&
      this.regionEl.contains(document.activeElement);
    this.remove(id);
    if (!hadFocus) {
      return;
    }
    if (target) {
      target.focus();
    } else {
      this.restorePriorFocus();
    }
  }

  private restorePriorFocus() {
    let previous = this.priorFocus;
    this.priorFocus = undefined;
    if (previous && previous.isConnected) {
      previous.focus();
    }
  }

  onDismissClick = (item: ToastItem) => {
    this.dismissAndKeepFocus(item.id);
  };

  onActionClick = (item: ToastItem) => {
    item.onAction?.();
    this.dismissAndKeepFocus(item.id);
  };

  // ── The clock ────────────────────────────────────────────────────────

  /**
   * The whole auto-dismiss mechanism: one listener on the life bar, removed
   * in the destructor. No handle is ever held, so nothing can re-arm and
   * nothing can outlive the element.
   */
  agesOut = modifier((el: HTMLElement, [id]: [string]) => {
    let onEnd = () => this.dismissAndKeepFocus(id);
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  });

  // ── Element wiring and focus ─────────────────────────────────────────

  captureRegion = modifier((el: HTMLElement) => {
    this.regionEl = el;
    let onFocusIn = (event: Event) => {
      let from = (event as FocusEvent).relatedTarget;
      if (from instanceof HTMLElement && !el.contains(from)) {
        this.priorFocus = from;
      }
    };
    el.addEventListener('focusin', onFocusIn);
    return () => {
      el.removeEventListener('focusin', onFocusIn);
      this.regionEl = undefined;
    };
  });

  captureDismiss = modifier((el: HTMLElement, [id]: [string]) => {
    this.dismissEls.set(id, el);
    return () => {
      if (this.dismissEls.get(id) === el) {
        this.dismissEls.delete(id);
      }
    };
  });

  /**
   * F6 — the only key that reaches a toast without a mouse.
   *
   * A toast is announced and then, in every kit but Base UI, unreachable: it
   * is not in the tab order of the document the reader is working in, and by
   * the time they tab to it, it is gone. F6 is the platform's own "cycle
   * panes" key, so it is the right one to borrow. From inside the region it
   * returns focus where it came from, which is what makes it safe to press.
   */
  onDocumentKey = (event: Event) => {
    if ((this.args.hotkey ?? true) === false) {
      return;
    }
    let ev = event as KeyboardEvent;
    if (ev.key !== 'F6' || this.visible.length === 0) {
      return;
    }
    let region = this.regionEl;
    if (!region) {
      return;
    }
    // Consumed, or a browser that cycles F6 into its own chrome takes focus
    // straight back out of the region.
    ev.preventDefault();
    let active = document.activeElement;
    if (active instanceof HTMLElement && region.contains(active)) {
      this.restorePriorFocus();
      return;
    }
    if (active instanceof HTMLElement) {
      this.priorFocus = active;
    }
    let first = region.querySelector<HTMLElement>(FOCUSABLE_IN_TOAST);
    (first ?? region).focus();
  };

  onVisibility = () => {
    this.hidden = document.visibilityState === 'hidden';
  };

  <template>
    <section
      class='pretui-toaster'
      aria-label={{this.regionLabel}}
      tabindex='-1'
      data-placement={{this.placement}}
      data-paused={{this.pausedAttr}}
      data-pause-hover={{this.pauseHoverAttr}}
      data-pause-focus={{this.pauseFocusAttr}}
      data-test-pretui-toaster
      {{this.captureRegion}}
      {{listenDocumentCapture 'keydown' this.onDocumentKey}}
      {{listenDocument 'visibilitychange' this.onVisibility false}}
      ...attributes
    >
      {{#each this.visible key='id' as |item|}}
        <div
          class='pretui-toast-item'
          role={{this.roleOf item}}
          aria-live={{this.liveOf item}}
          aria-atomic='true'
          data-tone={{this.toneOf item}}
          data-test-pretui-toast-item={{item.id}}
          style={{this.lifeStyle item}}
        >
          <div class='pretui-toast-face'>
            {{#if (has-block 'toast')}}
              {{yield item to='toast'}}
            {{else}}
              <div class='pretui-toast-text'>
                <span class='pretui-toast-title'>{{item.title}}</span>
                {{#if item.message}}
                  <span class='pretui-toast-msg'>{{item.message}}</span>
                {{/if}}
              </div>
            {{/if}}

            {{#if item.actionLabel}}
              <button
                type='button'
                class='pretui-toast-do'
                data-test-pretui-toast-action
                {{on 'click' (fn this.onActionClick item)}}
              >{{item.actionLabel}}</button>
            {{/if}}

            {{#if (this.isDismissible item)}}
              <button
                type='button'
                class='pretui-toast-x'
                aria-label={{this.dismissLabel}}
                data-test-pretui-toast-dismiss
                {{this.captureDismiss item.id}}
                {{on 'click' (fn this.onDismissClick item)}}
              >
                <svg width='10' height='10' viewBox='0 0 12 12' aria-hidden='true'><path
                    d='M2 2l8 8M10 2l-8 8'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.6'
                    stroke-linecap='round'
                  /></svg>
              </button>
            {{/if}}
          </div>

          {{#if (this.hasClock item)}}
            {{!-- The clock. An animationend on THIS element is the
                  dismissal, so no timer handle exists to leak or re-arm.
                  Keyed on the item object, so a same-id replacement (a
                  Saving… that becomes Saved) gets a fresh bar and a fresh
                  clock rather than the old one's remainder. --}}
            {{#each (this.one item) key='@identity' as |current|}}
              <span
                class='pretui-toast-life'
                aria-hidden='true'
                data-test-pretui-toast-life
                {{this.agesOut current.id}}
              ></span>
            {{/each}}
          {{/if}}
        </div>
      {{/each}}

      {{#if this.queued}}
        <p class='pretui-toaster-more' data-test-pretui-toaster-queued>
          <span class='pretui-toaster-more-n'>+{{this.queued}}</span>
          waiting
        </p>
      {{/if}}
    </section>

    <style scoped>
      @keyframes pretui-toast-age {
        from {
          transform: scaleX(1);
        }
        to {
          transform: scaleX(0);
        }
      }

      .pretui-toaster {
        /* A toast region must escape every scroll container and every
           overflow-hidden ancestor between it and the viewport, which is the
           one thing absolute and sticky cannot do. Same accepted warning
           overlay.gts carries for Popup and the Popover backdrop. */
        position: fixed;
        z-index: var(--pretui-z-toast, 100);
        display: grid;
        gap: var(--space-3, 8px);
        width: min(var(--pretui-toaster-width, 380px), calc(100vw - 24px));
        padding: var(--space-4, 11px);
        pointer-events: none;
        outline: none;
        font-family: var(--font-sans);
      }
      .pretui-toaster > * {
        pointer-events: auto;
      }
      .pretui-toaster[data-placement^='top'] {
        top: 0;
      }
      .pretui-toaster[data-placement^='bottom'] {
        bottom: 0;
      }
      /* Written out rather than as a suffix-match attribute selector: the
         dollar sign it needs counts toward the twelve-metacharacter threshold
         that
         silently kills the lint pass's template extraction, and two extra
         selectors are cheaper than a booby trap for whoever edits this next. */
      .pretui-toaster[data-placement='top-start'],
      .pretui-toaster[data-placement='bottom-start'] {
        inset-inline-start: 0;
      }
      .pretui-toaster[data-placement='top-end'],
      .pretui-toaster[data-placement='bottom-end'] {
        inset-inline-end: 0;
      }
      .pretui-toaster[data-placement='top'],
      .pretui-toaster[data-placement='bottom'] {
        inset-inline: 0;
        margin-inline: auto;
      }

      .pretui-toast-item {
        position: relative;
        overflow: hidden;
        display: grid;
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
        font-size: var(--text-ui-md, 12.5px);
        opacity: 1;
        translate: 0 0;
        transition: opacity var(--pretui-dur-enter, 220ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1)),
          translate var(--pretui-dur-enter, 220ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1));
      }
      @starting-style {
        .pretui-toaster[data-placement^='bottom'] .pretui-toast-item {
          opacity: 0;
          translate: 0 12px;
        }
        .pretui-toaster[data-placement^='top'] .pretui-toast-item {
          opacity: 0;
          translate: 0 -12px;
        }
      }

      .pretui-toast-face {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 8px);
        padding: var(--space-4, 11px);
      }
      .pretui-toast-text {
        display: grid;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .pretui-toast-title {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pretui-toast-msg {
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.5;
      }
      .pretui-toast-do {
        flex: none;
        border: 0;
        background: transparent;
        color: var(--pretui-toast-tone, var(--primary));
        font: inherit;
        font-weight: 600;
        padding: 2px 4px;
        border-radius: var(--radius-control, 6px);
        cursor: pointer;
      }
      .pretui-toast-do:hover {
        background: var(--hover, color-mix(in oklch, currentColor 10%, transparent));
      }
      .pretui-toast-x {
        flex: none;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: var(--radius-control, 6px);
        background: transparent;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-toast-x:hover {
        color: var(--foreground);
        background: var(--hover, color-mix(in oklch, currentColor 10%, transparent));
      }
      .pretui-toast-do:focus-visible,
      .pretui-toast-x:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }

      /* Touch: the dismiss control has to clear 44px on a coarse pointer, and
         it does it by growing its hit area rather than its ink. */
      @media (any-pointer: coarse) {
        .pretui-toast-x::after,
        .pretui-toast-do::after {
          content: '';
          position: absolute;
          inset: auto;
          min-width: 44px;
          min-height: 44px;
        }
        .pretui-toast-x {
          position: relative;
          width: 28px;
          height: 28px;
        }
      }

      /* Tone. One recipe, seven hue tokens (Appendix E.1) — the stripe is the
         only place a tone paints, so a neutral toast is genuinely neutral. */
      .pretui-toast-item[data-tone='info'] {
        --pretui-toast-tone: var(--pretui-info, var(--boxel-blue));
      }
      .pretui-toast-item[data-tone='success'] {
        --pretui-toast-tone: var(--success, var(--boxel-success));
      }
      .pretui-toast-item[data-tone='warning'] {
        --pretui-toast-tone: var(--warning, var(--boxel-warning));
      }
      .pretui-toast-item[data-tone='danger'] {
        --pretui-toast-tone: var(--destructive);
      }
      .pretui-toast-item[data-tone='neutral'] {
        --pretui-toast-tone: var(--muted-foreground);
      }
      .pretui-toast-item::before {
        content: '';
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        width: 3px;
        background: var(--pretui-toast-tone, var(--muted-foreground));
      }

      .pretui-toast-life {
        display: block;
        height: 2px;
        transform-origin: left center;
        background: var(--pretui-toast-tone, var(--muted-foreground));
        opacity: 0.55;
        animation: pretui-toast-age var(--pretui-toast-life, 5s) linear forwards;
      }
      .pretui-toaster[data-paused] .pretui-toast-life,
      .pretui-toaster[data-pause-hover]:hover .pretui-toast-life,
      .pretui-toaster[data-pause-focus]:focus-within .pretui-toast-life {
        animation-play-state: paused;
      }

      .pretui-toaster-more {
        margin: 0;
        justify-self: end;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--popover);
        box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border));
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 11.5px);
      }
      .pretui-toaster-more-n {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        color: var(--foreground);
      }

      /* Reduced motion takes the ENTRANCE, never the clock. The life bar is
         not decoration — it is the toast's remaining time, and WCAG 2.3.3
         exempts motion essential to the information conveyed. Stopping it
         would stop the dismissal itself. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-toast-item {
          transition: none;
        }
      }
    </style>
  </template>
}
