// Pretui — MorphingPopover: a Popup that grows out of its trigger.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { listenDocument, listenDocumentCapture } from '../focus';
import { Popup } from './popup';
import type { PopupPlacement } from '../internal/overlay';
import { morphFrom } from '../internal/structure-morph';

// ── MorphingPopover ──────────────────────────────────────────────────────

export interface MorphingPopoverSignature {
  Args: {
    /** Accessible name for the panel. */
    label: string;
    /** Controlled open state. Omit for uncontrolled. */
    open?: boolean;
    /** Fires with the next open state on every change. */
    onOpenChange?: (open: boolean) => void;
    /** Where the panel sits relative to the trigger. Default
     * `bottom-start`; `anchorTo` flips and shifts it to stay on screen. */
    placement?: PopupPlacement;
    /** Gap between trigger and panel in px. Default 8. */
    distance?: number;
    /** Match the panel's minimum width to the trigger's. Default false. */
    matchWidth?: boolean;
  };
  Blocks: {
    /** The trigger's face. */
    trigger: [];
    /** The panel contents. Receives a `close` action so a control inside
     * the panel can dismiss it without the caller tracking state. */
    default: [close: () => void];
  };
  Element: HTMLSpanElement;
}

/**
 * A trigger that grows into its own anchored panel.
 *
 * ```hbs
 * <MorphingPopover @label='Filters'>
 *   <:trigger>Filters</:trigger>
 *   <:default as |close|><FilterSet @onDone={{close}} /></:default>
 * </MorphingPopover>
 * ```
 *
 * WRAPS `Popup`, so placement, flipping, shifting and the scroll/resize
 * re-placement are `anchorTo`'s rather than a second copy. Added here: the
 * morph out of the trigger's rectangle (`morphFrom`), Escape in the CAPTURE
 * phase so a host that also listens for Escape cannot make one keypress mean
 * two things, outside-pointer dismissal, focus into the panel on open, and
 * focus back to the trigger on close.
 *
 * Better than the inspiration (motion-primitives' MorphingPopover): upstream
 * ships the morph and nothing else — no placement logic (it is absolutely
 * positioned and will happily render off-screen), no Escape, no outside
 * click, no focus management, and a `div` trigger. Here the trigger is a
 * `<button>` with `aria-haspopup` and `aria-expanded`, the panel is a
 * `role='dialog'` with a name, and every dismissal path returns focus.
 */
export class MorphingPopover extends Component<MorphingPopoverSignature> {
  @tracked private internalOpen = false;
  @tracked private origin: DOMRect | undefined = undefined;
  private triggerEl?: HTMLElement;

  private panelId = guidFor(this) + '-morph-popover';

  captureTrigger = modifier((element: HTMLElement) => {
    this.triggerEl = element;
  });

  /** Focus moves INTO the panel on open — an overlay whose content the
   * keyboard cannot reach is not an overlay, it is a decoration. */
  focusPanel = modifier((element: HTMLElement) => {
    element.focus();
  });

  get open(): boolean {
    return this.args.open ?? this.internalOpen;
  }

  get morphOrigin(): DOMRect | undefined {
    return this.open ? this.origin : undefined;
  }

  get distance(): number {
    return this.args.distance ?? 8;
  }

  private setOpen(next: boolean): void {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  toggle = () => {
    if (this.open) {
      this.close();
      return;
    }
    this.origin = this.triggerEl?.getBoundingClientRect();
    this.setOpen(true);
  };

  close = () => {
    if (!this.open) {
      return;
    }
    this.setOpen(false);
    // Focus RETURN. The native <dialog> gives this for free; an anchored
    // panel has to do it, and almost none of them do.
    this.triggerEl?.focus();
  };

  onDocumentKeydown = (event: Event) => {
    if (!this.open) {
      return;
    }
    let key = (event as KeyboardEvent).key;
    if (key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.close();
    }
  };

  onDocumentPointerdown = (event: Event) => {
    if (!this.open) {
      return;
    }
    let target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (this.triggerEl?.contains(target)) {
      return;
    }
    let panel = document.getElementById(this.panelId);
    if (panel?.contains(target)) {
      return;
    }
    this.setOpen(false);
  };

  <template>
    <Popup
      @open={{this.open}}
      @placement={{@placement}}
      @distance={{this.distance}}
      @matchWidth={{@matchWidth}}
      data-test-pretui-morphing-popover
      ...attributes
    >
      <:anchor>
        <button
          type='button'
          class='pretui-morph-pop-trigger'
          aria-haspopup='dialog'
          aria-expanded={{if this.open 'true' 'false'}}
          aria-controls={{if this.open this.panelId}}
          data-test-pretui-morphing-popover-trigger
          {{this.captureTrigger}}
          {{on 'click' this.toggle}}
        >
          {{yield to='trigger'}}
        </button>
      </:anchor>
      <:default>
        <div
          class='pretui-morph-pop-panel'
          id={{this.panelId}}
          role='dialog'
          aria-label={{@label}}
          tabindex='-1'
          data-test-pretui-morphing-popover-panel
          {{this.focusPanel}}
          {{morphFrom this.morphOrigin}}
          {{listenDocumentCapture 'keydown' this.onDocumentKeydown}}
          {{listenDocument 'pointerdown' this.onDocumentPointerdown true}}
        >
          {{yield this.close}}
        </div>
      </:default>
    </Popup>

    <style scoped>
      @layer PretComponent {
        .pretui-morph-pop-trigger {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2, 6px);
          padding: 6px 11px;
          min-block-size: 30px;
          border: 0;
          border-radius: var(--radius-control, 7px);
          background: var(--card);
          color: var(--foreground);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.3)
          );
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          cursor: pointer;
        }
        @media (any-pointer: coarse) {
          .pretui-morph-pop-trigger {
            min-block-size: 44px;
          }
        }
        .pretui-morph-pop-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-morph-pop-panel {
          min-inline-size: var(--pretui-morph-popover-width, 240px);
          max-inline-size: min(92vw, 420px);
          padding: var(--space-4, 11px);
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          color: var(--foreground);
          box-shadow: var(
            --pretui-shadow-overlay,
            0 0 0 1px var(--border),
            0 8px 28px rgb(0 0 0 / 0.34)
          );
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 12.5px);
          /* Transform origin follows the anchor edge so the morph reads as
             growth out of the trigger rather than a slide from nowhere. */
          transform-origin: top left;
        }
        .pretui-morph-pop-panel:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
      }
    </style>
  </template>
}
