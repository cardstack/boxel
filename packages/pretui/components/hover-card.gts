// Pretui — HoverCard: a rich preview that opens on hover or focus.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { Popup } from './popup';
import type { PopupPlacement } from '../internal/overlay';
import { OwnedTimers, listenDocument, listenDocumentCapture, ownsTimers } from '../focus';
import { controlIn } from '../internal/overlay-confirm';

// ─────────────────────────────────────────────────────────────────────────
// HoverCard
// ─────────────────────────────────────────────────────────────────────────

export interface HoverCardSignature {
  Args: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** default 'bottom-start' */
    placement?: PopupPlacement;
    /** gap between trigger and card, px (default 8) */
    distance?: number;
    /**
     * Seconds of hover before the card opens (default 0.5). Seconds, not the
     * `700` Radix passes — a bare number in a prop is a unit no caller can
     * check.
     */
    openDelay?: number;
    /** Seconds after the pointer leaves before it closes (default 0.3). The
     * pair matters more than either value: the close delay is the bridge
     * across the gap between trigger and card. */
    closeDelay?: number;
    /** accessible name for the card (default 'Preview') */
    label?: string;
    /** on coarse pointers a tap opens the card, since hover does not exist
     * there at all (default true) */
    tapToOpen?: boolean;
  };
  Blocks: {
    trigger: [];
    default: [close: () => void];
  };
  Element: HTMLSpanElement;
}

/**
 * The rich link/user preview: a `Popup` with hover intent in front of it.
 *
 * ── Accessibility is the whole problem ──────────────────────────────────
 *
 * Content that only appears on hover is content a keyboard user, a screen
 * reader user and every touch device cannot reach. The three fixes, in the
 * order they matter:
 *
 *  1. **Focus opens it, with no delay.** A hover delay exists to stop the card
 *     firing as the pointer crosses the link; a keyboard user who has
 *     deliberately tabbed to the trigger has already expressed the intent, so
 *     making them wait half a second is pure latency.
 *  2. **The content is not a keyboard trap, and not a dead end either.**
 *     Radix's HoverCard sets `tabindex='-1'` on every tabbable node inside the
 *     card — which does prevent a trap, at the price of making the card's own
 *     links unreachable by the exact users who most needed them reachable.
 *     Here the card renders in DOM order immediately after the trigger and
 *     keeps its tab stops, so Tab walks *into* it, Tab out of the last one
 *     leaves and closes it, and Escape closes it and returns focus to the
 *     trigger. Nothing is unreachable and nothing is inescapable.
 *  3. **Touch gets a path at all.** Radix explicitly excludes touch from
 *     opening, so on a phone the card simply does not exist. `@tapToOpen`
 *     opens it on a non-mouse pointer without swallowing the trigger's own
 *     activation, so a link stays a link.
 *
 * The trigger's control also carries `aria-expanded` and `aria-controls` — a
 * relationship neither Radix nor shadcn establishes, so in those kits a
 * screen-reader user is not told the preview exists even when it is open.
 *
 * ── Timers ──────────────────────────────────────────────────────────────
 *
 * The two delays are `OwnedTimers` handles: an `ember-modifier` adopts the
 * set and releases it in its destructor, each handle is one-shot, and opening
 * cancels the close handle and vice versa, so neither can re-arm. Where the
 * modifier has not installed, `OwnedTimers` schedules nothing and the card
 * degrades to opening and closing immediately — a working behaviour, not a
 * broken one.
 */
export class HoverCard extends Component<HoverCardSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private openHandle: ReturnType<typeof setTimeout> | undefined;
  private closeHandle: ReturnType<typeof setTimeout> | undefined;
  private triggerControl: HTMLElement | undefined;
  private hostEl: HTMLElement | undefined;

  @tracked private internalOpen = this.args.defaultOpen ?? false;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get panelId(): string {
    return this.guid + '-card';
  }
  get panelLabel(): string {
    return this.args.label ?? 'Preview';
  }
  get placement(): PopupPlacement {
    return this.args.placement ?? 'bottom-start';
  }
  private get openMs(): number {
    return Math.max(0, (this.args.openDelay ?? 0.5) * 1000);
  }
  private get closeMs(): number {
    return Math.max(0, (this.args.closeDelay ?? 0.3) * 1000);
  }

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  private clearHandles() {
    this.timers.cancel(this.openHandle);
    this.timers.cancel(this.closeHandle);
    this.openHandle = undefined;
    this.closeHandle = undefined;
  }

  /** Opens after `openDelay`, or immediately when `immediate` (focus, touch)
   * or when no modifier has taken timer ownership. */
  private wantOpen(immediate: boolean) {
    this.clearHandles();
    if (this.isOpen) {
      return;
    }
    if (immediate || this.openMs === 0 || !this.timers.active) {
      this.setOpen(true);
      return;
    }
    this.openHandle = this.timers.after(this.openMs, () => {
      this.openHandle = undefined;
      this.setOpen(true);
    });
  }

  private wantClose(immediate: boolean) {
    this.clearHandles();
    if (!this.isOpen) {
      return;
    }
    if (immediate || this.closeMs === 0 || !this.timers.active) {
      this.setOpen(false);
      return;
    }
    this.closeHandle = this.timers.after(this.closeMs, () => {
      this.closeHandle = undefined;
      this.setOpen(false);
    });
  }

  /** Closes and puts focus back on the trigger. Every dismissal path a
   * keyboard reader can take goes through here. */
  close = () => {
    this.clearHandles();
    this.setOpen(false);
    this.triggerControl?.focus();
  };

  onPointerEnter = (event: Event) => {
    let ev = event as PointerEvent;
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
      if (this.args.tapToOpen ?? true) {
        this.wantOpen(true);
      }
      return;
    }
    this.wantOpen(false);
  };

  onPointerLeave = (event: Event) => {
    let ev = event as PointerEvent;
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
      return;
    }
    this.wantClose(false);
  };

  onFocusIn = () => {
    this.wantOpen(true);
  };

  onFocusOut = (event: Event) => {
    let to = (event as FocusEvent).relatedTarget;
    if (to instanceof Node && this.hostEl?.contains(to)) {
      return;
    }
    this.wantClose(true);
  };

  onEscape = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.close();
  };

  /** Touch dismissal: a tap outside closes what a tap opened. */
  onDocumentPointerDown = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    if (target && this.hostEl?.contains(target)) {
      return;
    }
    this.wantClose(true);
  };

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
    let enter = (event: Event) => this.onPointerEnter(event);
    let leave = (event: Event) => this.onPointerLeave(event);
    let focusIn = () => this.onFocusIn();
    let focusOut = (event: Event) => this.onFocusOut(event);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focusIn);
    el.addEventListener('focusout', focusOut);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('focusout', focusOut);
      this.hostEl = undefined;
      this.clearHandles();
    };
  });

  captureTrigger = modifier((el: HTMLElement) => {
    this.triggerControl = controlIn(el);
  });

  triggerBehavior = modifier(
    (el: HTMLElement, [isOpen, panelId]: [boolean, string]) => {
      let control = controlIn(el);
      control.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      control.setAttribute('aria-controls', panelId);
      return () => {
        control.removeAttribute('aria-expanded');
        control.removeAttribute('aria-controls');
      };
    },
  );

  <template>
    <span
      class='pretui-hc'
      data-test-pretui-hovercard
      data-state={{if this.isOpen 'open' 'closed'}}
      {{this.captureHost}}
      {{ownsTimers this.timers}}
      ...attributes
    >
      <Popup
        @open={{this.isOpen}}
        @placement={{this.placement}}
        @distance={{if @distance @distance 8}}
      >
        <:anchor>
          <span
            class='pretui-hc-trigger'
            {{this.captureTrigger}}
            {{this.triggerBehavior this.isOpen this.panelId}}
          >{{yield to='trigger'}}</span>
        </:anchor>
        <:default>
          <div
            class='pretui-hc-panel'
            id={{this.panelId}}
            role='dialog'
            aria-label={{this.panelLabel}}
            data-test-pretui-hovercard-panel
            {{listenDocumentCapture 'keydown' this.onEscape}}
            {{listenDocument 'pointerdown' this.onDocumentPointerDown true}}
          >
            {{yield this.close}}
          </div>
        </:default>
      </Popup>
    </span>

    <style scoped>
      .pretui-hc {
        display: inline-flex;
      }
      .pretui-hc-trigger {
        display: inline-flex;
      }
      .pretui-hc-panel {
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
        padding: var(--space-4, 11px);
        width: var(--pretui-hovercard-width, 260px);
        max-width: calc(100vw - 16px);
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 12.5px);
        opacity: 1;
        transform: none;
        transition: opacity var(--pretui-dur-enter, 180ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1)),
          transform var(--pretui-dur-enter, 180ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1));
      }
      @starting-style {
        .pretui-hc-panel {
          opacity: 0;
          transform: translateY(4px) scale(0.98);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-hc-panel {
          transition: none;
        }
      }
    </style>
  </template>
}
