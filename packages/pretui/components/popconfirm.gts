// Pretui — Popconfirm: an inline confirm anchored to its trigger, smaller than AlertDialog.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { Popup } from './popup';
import type { PopupPlacement } from '../internal/overlay';
import { Button } from './button';
import type { PretuiTone } from '../pretui-primitives';
import { listenDocument, listenDocumentCapture } from '../focus';
import { controlIn } from '../internal/overlay-confirm';

/**
 * Focuses the element on install. The panels here are rendered only while
 * open, so install IS open — which makes this fire exactly once per opening,
 * unlike `focusWhen`, whose `should` argument is re-evaluated on every
 * re-render and would keep dragging focus back.
 */
const focusOnInstall = modifier((el: HTMLElement) => {
  el.focus();
});
// ─────────────────────────────────────────────────────────────────────────
// Popconfirm
// ─────────────────────────────────────────────────────────────────────────

export interface PopconfirmSignature {
  Args: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** the question */
    title?: string;
    /** the second line, when the question needs one */
    description?: string;
    /** default 'Yes' */
    confirmLabel?: string;
    /** Ant alias for @confirmLabel */
    okText?: string;
    /** default 'No' */
    cancelLabel?: string;
    /** Ant alias for @cancelLabel */
    cancelText?: string;
    /** tone of the confirm button (default 'danger') */
    tone?: PretuiTone;
    /** where the bubble sits relative to its trigger (default 'top') */
    placement?: PopupPlacement;
    /** gap between trigger and bubble, px (default 6) */
    distance?: number;
    /** false leaves only the confirm button (Ant's showCancel) */
    showCancel?: boolean;
    /** the trigger opens nothing while true */
    disabled?: boolean;
    /** holds the bubble open with the confirm button pending */
    busy?: boolean;
    /** accessible name for the bubble (default: @title, else 'Confirm') */
    label?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  };
  Blocks: {
    trigger: [open: boolean, toggle: () => void];
    /** replaces the title/description body */
    default: [];
    /** replaces both buttons; receives confirm and cancel */
    footer: [confirm: () => void, cancel: () => void];
  };
  Element: HTMLSpanElement;
}

/**
 * Ant's inline "are you sure?", anchored to the control it guards.
 *
 * ── When to reach for this instead of AlertDialog ────────────────────────
 *
 * The judgement is **how much the reader needs to re-read before answering**,
 * not how destructive the action is.
 *
 *  * **Popconfirm** when the object of the verb is the thing you just
 *    clicked, and it is still on screen: deleting *this* row, unpublishing
 *    *this* draft, revoking *this* key. The bubble points at the object, so
 *    the question needs no noun — "Delete this?" beside the row is unambiguous
 *    in a way "Delete Q3-forecast-v2.xlsx?" in a centred modal is not. It is
 *    also reversible-feeling: the page never went away.
 *  * **AlertDialog** when the consequence is not visible from where the click
 *    happened, needs more than one line to state, spans more than one object
 *    ("delete 47 records"), or is genuinely irreversible. A modal earns its
 *    interruption by forcing the reader to stop; a bubble that is easy to
 *    dismiss by looking away is the wrong instrument for a decision you want
 *    someone to actually make.
 *
 * The tell that a Popconfirm should have been an AlertDialog: you find
 * yourself wanting a third paragraph, a checkbox, or a "type the name to
 * confirm" field in it.
 *
 * **Better than Ant:** Ant's Popconfirm gives the trigger no ARIA at all —
 * no `aria-haspopup`, no `aria-expanded`, so a screen-reader user is told
 * nothing about the bubble that just appeared, and the bubble itself is not a
 * dialog. Here the trigger's own control gets the full contract (restored on
 * teardown, so the caller's element is left as it was found), the bubble is a
 * `role='dialog'` named by its question, focus moves into it on open and back
 * to the trigger on every dismissal path, and Escape is taken in the capture
 * phase so a host listening for it cannot act on the same keypress.
 */
export class Popconfirm extends Component<PopconfirmSignature> {
  private guid = guidFor(this);
  @tracked private internalOpen = this.args.defaultOpen ?? false;
  /** Written from a modifier body and read from another modifier's arguments,
   * so deliberately untracked — see the note in Menu. */
  private triggerControl: HTMLElement | undefined;
  private hostEl: HTMLElement | undefined;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get titleId(): string {
    return this.guid + '-title';
  }
  get confirmLabel(): string {
    return this.args.confirmLabel ?? this.args.okText ?? 'Yes';
  }
  get cancelLabel(): string {
    return this.args.cancelLabel ?? this.args.cancelText ?? 'No';
  }
  get tone(): PretuiTone {
    return this.args.tone ?? 'danger';
  }
  get placement(): PopupPlacement {
    return this.args.placement ?? 'top';
  }
  get showCancel(): boolean {
    return this.args.showCancel ?? true;
  }
  get panelLabel(): string {
    return this.args.label ?? this.args.title ?? 'Confirm';
  }

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  private dismiss(next: boolean) {
    this.setOpen(next);
    if (!next) {
      this.triggerControl?.focus();
    }
  }

  toggle = () => {
    if (this.args.disabled) {
      return;
    }
    this.dismiss(!this.isOpen);
  };

  confirm = () => {
    if (this.args.busy) {
      return;
    }
    this.args.onConfirm?.();
    if (!this.args.busy) {
      this.dismiss(false);
    }
  };

  cancel = () => {
    this.args.onCancel?.();
    this.dismiss(false);
  };

  onEscape = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.cancel();
  };

  /** Outside pointer dismissal, watched on the document rather than caught by
   * a covering backdrop: a backdrop swallows the click that dismissed it, so
   * closing a bubble to press the button behind it takes two clicks. */
  onDocumentPointerDown = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    let root = this.hostEl;
    if (target && root?.contains(target)) {
      return;
    }
    this.setOpen(false);
  };

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
    return () => {
      this.hostEl = undefined;
    };
  });

  captureTrigger = modifier((el: HTMLElement) => {
    this.triggerControl = controlIn(el);
  });

  /** The APG disclosure contract, applied to whatever control the caller put
   * in the trigger block, and fully restored on teardown. */
  triggerBehavior = modifier((el: HTMLElement, [isOpen]: [boolean]) => {
    let control = controlIn(el);
    let hadPopup = control.getAttribute('aria-haspopup');
    control.setAttribute('aria-haspopup', 'dialog');
    control.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    return () => {
      if (hadPopup === null) {
        control.removeAttribute('aria-haspopup');
      } else {
        control.setAttribute('aria-haspopup', hadPopup);
      }
      control.removeAttribute('aria-expanded');
    };
  });

  <template>
    <span
      class='pretui-pc'
      data-test-pretui-popconfirm
      {{this.captureHost}}
      ...attributes
    >
      <Popup
        @open={{this.isOpen}}
        @placement={{this.placement}}
        @distance={{if @distance @distance 6}}
      >
        <:anchor>
          <span
            class='pretui-pc-trigger'
            {{this.captureTrigger}}
            {{this.triggerBehavior this.isOpen}}
          >{{yield this.isOpen this.toggle to='trigger'}}</span>
        </:anchor>
        <:default>
          <div
            class='pretui-pc-panel'
            role='dialog'
            aria-label={{this.panelLabel}}
            data-test-pretui-popconfirm-panel
            {{listenDocumentCapture 'keydown' this.onEscape}}
            {{listenDocument 'pointerdown' this.onDocumentPointerDown true}}
          >
            <div class='pretui-pc-body'>
              <span class='pretui-pc-mark' aria-hidden='true'>!</span>
              <div class='pretui-pc-text'>
                {{#if (has-block)}}
                  {{yield}}
                {{else}}
                  <span id={{this.titleId}} class='pretui-pc-title'>{{@title}}</span>
                  {{#if @description}}
                    <span class='pretui-pc-desc'>{{@description}}</span>
                  {{/if}}
                {{/if}}
              </div>
            </div>
            <div class='pretui-pc-acts'>
              {{#if (has-block 'footer')}}
                {{yield this.confirm this.cancel to='footer'}}
              {{else if this.showCancel}}
                <Button
                  @tone='neutral'
                  @appearance='plain'
                  @size='s'
                  data-test-pretui-popconfirm-cancel
                  {{focusOnInstall}}
                  {{on 'click' this.cancel}}
                >{{this.cancelLabel}}</Button>
                <Button
                  @tone={{this.tone}}
                  @appearance='accent'
                  @size='s'
                  aria-busy={{if @busy 'true'}}
                  data-state={{if @busy 'busy'}}
                  data-test-pretui-popconfirm-confirm
                  {{on 'click' this.confirm}}
                >{{this.confirmLabel}}</Button>
              {{else}}
                <Button
                  @tone={{this.tone}}
                  @appearance='accent'
                  @size='s'
                  aria-busy={{if @busy 'true'}}
                  data-state={{if @busy 'busy'}}
                  data-test-pretui-popconfirm-confirm
                  {{focusOnInstall}}
                  {{on 'click' this.confirm}}
                >{{this.confirmLabel}}</Button>
              {{/if}}
            </div>
          </div>
        </:default>
      </Popup>
    </span>

    <style scoped>
      .pretui-pc {
        display: inline-flex;
      }
      .pretui-pc-trigger {
        display: inline-flex;
      }
      .pretui-pc-panel {
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
        padding: var(--space-4, 11px);
        width: max-content;
        max-width: var(--pretui-popconfirm-max-width, min(280px, calc(100vw - 16px)));
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 12.5px);
        opacity: 1;
        transform: none;
        transition: opacity var(--pretui-dur-enter, 180ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1)),
          transform var(--pretui-dur-enter, 180ms) var(--pretui-ease-enter, cubic-bezier(0.23, 1, 0.32, 1));
      }
      @starting-style {
        .pretui-pc-panel {
          opacity: 0;
          transform: scale(0.97);
        }
      }
      .pretui-pc-body {
        display: flex;
        gap: var(--space-3, 8px);
        align-items: flex-start;
      }
      .pretui-pc-mark {
        flex: none;
        width: 15px;
        height: 15px;
        margin-top: 1px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 9px;
        font-weight: 700;
        background: var(--warning, var(--boxel-warning));
        color: var(--pretui-on-warning, var(--background));
      }
      .pretui-pc-text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pretui-pc-title {
        font-weight: 600;
        line-height: 1.4;
      }
      .pretui-pc-desc {
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.5;
      }
      .pretui-pc-acts {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2, 6px);
        margin-top: var(--space-4, 11px);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-pc-panel {
          transition: none;
        }
      }
    </style>
  </template>
}
