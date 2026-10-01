// Pretui — AlertDialog: a modal confirmation that demands an explicit answer.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { on } from '@ember/modifier';
import { Dialog } from './dialog';
import { Button } from './button';
import type { PretuiTone } from '../pretui-primitives';
import { listenDocumentCapture } from '../focus';

// ─────────────────────────────────────────────────────────────────────────
// AlertDialog
// ─────────────────────────────────────────────────────────────────────────

export interface AlertDialogSignature {
  Args: {
    /** controlled open state; omit for uncontrolled */
    open?: boolean;
    /** the uncontrolled starting state */
    defaultOpen?: boolean;
    /** fires on every transition, controlled or not */
    onOpenChange?: (open: boolean) => void;
    /** the question, as a string. `<:header>` takes markup instead. */
    title?: string;
    /** the consequence, as a string. `<:default>` takes markup instead. */
    description?: string;
    /** the confirm button's label (default 'Continue') */
    confirmLabel?: string;
    /** the cancel button's label (default 'Cancel') */
    cancelLabel?: string;
    /** tone of the confirm button (default 'danger' — this is the pattern
     * for destructive actions, and a neutral confirm is the unusual case) */
    tone?: PretuiTone;
    /** puts the confirm button in its pending state without disabling it */
    busy?: boolean;
    size?: 's' | 'm' | 'l';
    /** Escape cancels (default true). Outside clicks NEVER dismiss — that is
     * the difference from Dialog, and it is not a knob. */
    dismissOnEscape?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  };
  Blocks: {
    trigger: [open: boolean, toggle: () => void];
    header: [];
    default: [];
    footer: [confirm: () => void, cancel: () => void];
  };
  Element: HTMLDialogElement;
}

/**
 * The destructive-confirm every shadcn app has, composed from `Dialog`.
 *
 * Four things separate it from a Dialog, and each one is a decision rather
 * than a style:
 *
 *  1. **It is always modal.** A confirmation that can be ignored by clicking
 *     past it is not a confirmation.
 *  2. **No dismiss on outside click.** A stray click must not read as an
 *     answer. `Dialog`'s single `@dismissible` flag conflates outside-click
 *     with Escape, so this passes `@dismissible={{false}}` and takes Escape
 *     itself — in the capture phase, so a host listening for Escape cannot
 *     make one keypress mean two things.
 *  3. **Focus starts on Cancel.** Cancel is first in DOM order, so the native
 *     `<dialog>` focusing steps land there with no JS at all — the platform
 *     doing the work is both smaller and more reliable than a focus call.
 *     Reading order stays Cancel → Confirm, which is also the shadcn layout.
 *  4. **`role='alertdialog'`**, which is what tells assistive technology this
 *     interrupts rather than presents, plus `aria-labelledby` on the question
 *     and `aria-describedby` on the consequence.
 *
 * **Better than shadcn/Radix:** Radix's `AlertDialogAction` closes the dialog
 * on click whether or not the work succeeded, so a failed confirm leaves no
 * surface to report the failure on. `@busy` here holds the dialog open with
 * the confirm button in Aria's *pending* state — `aria-busy` and inert, with
 * focus retained, never the native `disabled` attribute that would drop focus
 * onto the body mid-action. (Pretui's own `Button` still resolves `@busy` to
 * `disabled`; until that is fixed the pending state is applied through
 * attributes here, which costs the button's spinner.)
 */
export class AlertDialog extends Component<AlertDialogSignature> {
  private guid = guidFor(this);
  @tracked private internalOpen = this.args.defaultOpen ?? false;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get titleId(): string {
    return this.guid + '-title';
  }
  get descId(): string {
    return this.guid + '-desc';
  }
  get confirmLabel(): string {
    return this.args.confirmLabel ?? 'Continue';
  }
  get cancelLabel(): string {
    return this.args.cancelLabel ?? 'Cancel';
  }
  get tone(): PretuiTone {
    return this.args.tone ?? 'danger';
  }

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  toggle = () => {
    this.setOpen(!this.isOpen);
  };

  confirm = () => {
    // Pending is inert without being disabled: a second activation while the
    // caller's work is in flight must not fire it twice, but the button has
    // to stay focusable for the announcement to reach anyone.
    if (this.args.busy) {
      return;
    }
    this.args.onConfirm?.();
    if (!this.args.busy) {
      this.setOpen(false);
    }
  };

  cancel = () => {
    this.args.onCancel?.();
    this.setOpen(false);
  };

  /** Dialog requires an `@onClose`; with `@dismissible={{false}}` it is never
   * called, but wiring it to cancel means a platform-level close (a future
   * `requestClose`, a devtools call) still routes through one path. */
  onPlatformClose = () => {
    this.cancel();
  };

  onEscape = (event: Event) => {
    if ((this.args.dismissOnEscape ?? true) === false) {
      return;
    }
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.cancel();
  };

  <template>
    {{#if (has-block 'trigger')}}
      <span class='pretui-ad-trigger' data-test-pretui-alertdialog-trigger>
        {{yield this.isOpen this.toggle to='trigger'}}
      </span>
    {{/if}}

    <Dialog
      @open={{this.isOpen}}
      @onClose={{this.onPlatformClose}}
      @dismissible={{false}}
      @size={{@size}}
      role='alertdialog'
      aria-labelledby={{this.titleId}}
      aria-describedby={{this.descId}}
      data-test-pretui-alertdialog
      ...attributes
    >
      <:title>
        <span id={{this.titleId}}>
          {{#if (has-block 'header')}}{{yield to='header'}}{{else}}{{@title}}{{/if}}
        </span>
      </:title>
      <:default>
        {{#if this.isOpen}}
          {{!-- Escape is taken in the capture phase and only while open, so
                the listener's lifetime is exactly the dialog's open life. --}}
          <span
            class='pretui-ad-watch'
            {{listenDocumentCapture 'keydown' this.onEscape}}
          ></span>
        {{/if}}
        <div id={{this.descId}}>
          {{#if (has-block)}}{{yield}}{{else}}{{@description}}{{/if}}
        </div>
      </:default>
      <:footer>
        {{#if (has-block 'footer')}}
          {{yield this.confirm this.cancel to='footer'}}
        {{else}}
          {{!-- Cancel first in DOM order: the native dialog focusing steps
                land on the first focusable, so the safe choice is focused
                without a single focus() call. --}}
          <Button
            @tone='neutral'
            @appearance='outlined'
            data-test-pretui-alertdialog-cancel
            {{on 'click' this.cancel}}
          >{{this.cancelLabel}}</Button>
          {{!-- Pending, not disabled. Button's own busy arg resolves to the
                NATIVE disabled attribute, which drops focus onto the body the
                instant the work starts — the exact thing Appendix L's pending
                rule forbids. Setting the state through attributes instead
                keeps the button focusable and announced (aria-busy) while
                data-state=busy supplies Button's own pending dress and its
                pointer-events: none. The diff that would let this use the busy
                arg again is in the report.
                (No backticks in template text: the lint pass stops seeing the
                whole template past twelve of them.) --}}
          <Button
            @tone={{this.tone}}
            @appearance='accent'
            aria-busy={{if @busy 'true'}}
            data-state={{if @busy 'busy'}}
            data-test-pretui-alertdialog-confirm
            {{on 'click' this.confirm}}
          >{{this.confirmLabel}}</Button>
        {{/if}}
      </:footer>
    </Dialog>

    <style scoped>
      .pretui-ad-trigger {
        display: inline-flex;
      }
      .pretui-ad-watch {
        display: none;
      }
    </style>
  </template>
}
