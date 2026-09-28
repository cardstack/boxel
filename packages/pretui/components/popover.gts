// Pretui — Popover: an anchored panel with backdrop close and Escape from anywhere.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { listenDocumentCapture } from '../focus';
import { emit } from '../pretui-primitives';
import { resolvePlacement, resolveOpen } from '../internal/overlay';
import type { PopupPlacement, PlacementArgs, OpenArgs } from '../internal/overlay';
import { Popup } from './popup';

export interface PopoverSignature {
  Args: OpenArgs &
    PlacementArgs & {
      placement?: PopupPlacement | string;
      distance?: number;
      label?: string;
      /** the uncontrolled half of the hybrid */
      defaultOpen?: boolean;
      /** fires on every open and close, controlled or not */
      onOpenChange?: (open: boolean) => void;
    };
  Blocks: {
    trigger: [open: boolean, toggle: () => void];
    default: [close: () => void];
  };
  Element: HTMLSpanElement;
}

// Anything that can hold focus inside the anchor. Used to hand focus back to
// the control the panel was opened from — the panel's trigger is a caller
// block, so the component cannot capture the button directly the way
// MorphingPopover does.
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored floating panel: Popup positioning + the generalized backdrop-close
 * pattern (viewport-covering close target instead of a document listener).
 *
 * Escape closes it from anywhere — the trigger, the panel, or a control that
 * portalled its own DOM elsewhere. **Fixed 2026-08-13:** the listener used to
 * sit on the panel, so the ordinary path (open from the trigger, press
 * Escape without tabbing in) did nothing, and that bug rode into every
 * consumer — `DatePicker`, `DateRangePicker`, `ThemeFrame`. It now uses
 * `listenDocumentCapture` (focus.gts), installed on the panel so its lifetime
 * is exactly the open lifetime, in the CAPTURE phase with `stopPropagation`
 * so a host that also listens for Escape cannot make one keypress mean two
 * things. This is the 46f065-popover fork's rule — the overlay owns
 * dismissal, full stop — and the same idiom `MorphingPopover` already uses.
 *
 * Every dismissal path returns focus to the trigger.
 *
 * **Hybrid since 2026-08-13.** It was uncontrolled-only and emitted no event
 * at all: a parent could neither open it nor learn that it had opened, which
 * is the ship-blocking shape ("a control that mutates state without a
 * callback"). It now carries the kit's controlled/uncontrolled triple —
 * `@open` / `@defaultOpen` / `@onOpenChange` — and every existing caller,
 * all of which pass none of the three, keeps the exact behaviour it had.
 */
export class Popover extends Component<PopoverSignature> {
  @tracked internalOpen = this.args.defaultOpen ?? false;
  private anchorEl?: HTMLElement;
  captureAnchor = modifier((el: HTMLElement) => {
    this.anchorEl = el;
  });
  get controlled() {
    return resolveOpen(this.args);
  }
  get open() {
    return this.controlled ?? this.internalOpen;
  }
  /** side/align/position/direction fold into @placement before forwarding */
  get placement(): PopupPlacement {
    return resolvePlacement(this.args, 'bottom-start');
  }
  private setOpen(next: boolean) {
    if (this.controlled === undefined) {
      this.internalOpen = next;
    }
    emit([this.args.onOpenChange], next);
  }
  toggle = () => {
    this.setOpen(!this.open);
  };
  close = () => {
    if (!this.open) return;
    this.setOpen(false);
    this.restoreFocus();
  };
  // Focus RETURN. The native <dialog> gives this for free; an anchored panel
  // has to do it, and almost none of them do. The trigger is a caller block,
  // so the first focusable in the anchor that is not inside the floating
  // layer is the best available answer.
  private restoreFocus() {
    let root = this.anchorEl;
    if (!root) return;
    for (let el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (!el.closest('.pretui-popup')) {
        el.focus();
        return;
      }
    }
  }
  onKey = (e: Event) => {
    if (!this.open) return;
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    this.close();
  };
  <template>
    <span
      class='pretui-popover'
      data-test-pretui-popover
      {{this.captureAnchor}}
      ...attributes
    >
      <Popup
        @open={{this.open}}
        @placement={{this.placement}}
        @distance={{@distance}}
      >
        <:anchor>{{yield this.open this.toggle to='trigger'}}</:anchor>
        <:default>
          <button
            type='button'
            class='pretui-popover-backdrop'
            aria-label='Close'
            tabindex='-1'
            {{on 'click' this.close}}
          ></button>
          <div
            class='pretui-popover-panel'
            role='dialog'
            aria-label={{if @label @label 'Popover'}}
            tabindex='-1'
            {{listenDocumentCapture 'keydown' this.onKey}}
          >
            {{yield this.close}}
          </div>
        </:default>
      </Popup>
    </span>
    <style scoped>
      .pretui-popover {
        display: inline-block;
      }
      .pretui-popover-backdrop {
        /* wave-0 backdrop-close: viewport-covering close target instead of a
           document listener; fixed is intentional (lint warns, accepted) */
        position: fixed;
        inset: 0;
        background: transparent;
        border: 0;
        padding: 0;
        cursor: default;
      }
      .pretui-popover-panel {
        position: relative;
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: 10px;
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
        padding: var(--space-4, 11px);
        /* component-owned knobs: consumers size the panel by setting these
           custom properties on any ancestor — no :deep() required */
        width: var(--pretui-popover-width, auto);
        min-width: var(--pretui-popover-min-width, 200px);
        max-width: var(--pretui-popover-max-width, min(360px, calc(100vw - 16px)));
        /* The documented exception to "never remove an outline without a
           :focus-visible replacement": the panel is tabindex='-1' and is only
           ever focused programmatically on open, so :focus-visible never
           matches it and a ring here would only be a stray box around a
           region the user did not tab to. Every focusable thing INSIDE the
           panel keeps its own ring. */
        outline: none;
        opacity: 1;
        transform: none;
        transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-popover-panel {
          opacity: 0;
          transform: translateY(4px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-popover-panel {
          transition: none;
        }
      }
    </style>
  </template>
}
