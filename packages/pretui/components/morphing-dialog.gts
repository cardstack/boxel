// Pretui — MorphingDialog: a Dialog that grows out of its trigger.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { Dialog } from './dialog';
import { morphFrom } from '../internal/structure-morph';

// ── MorphingDialog ───────────────────────────────────────────────────────

export interface MorphingDialogSignature {
  Args: {
    /** Accessible name for the dialog, and its visible title when no
     * `<:title>` block is given. */
    label: string;
    /** Controlled open state. Omit for uncontrolled. */
    open?: boolean;
    /** Fires with the next open state on every change. */
    onOpenChange?: (open: boolean) => void;
    /** Dialog width preset, forwarded to `Dialog`. Default `m`. */
    size?: 's' | 'm' | 'l';
    /** Allow Escape and backdrop dismissal. Default true. */
    dismissible?: boolean;
  };
  Blocks: {
    /** The resting card. It becomes the trigger, and its rectangle is what
     * the dialog grows out of. */
    trigger: [];
    /** Visible dialog title. Falls back to `@label`. */
    title: [];
    /** Dialog body. */
    default: [];
    /** Actions row, rendered under a hairline at the foot of the body. */
    actions: [];
  };
  Element: HTMLDivElement;
}

/**
 * A card that grows into its own modal dialog.
 *
 * ```hbs
 * <MorphingDialog @label='Lot B-114'>
 *   <:trigger><LotCard @lot={{this.lot}} /></:trigger>
 *   <:default><LotDetail @lot={{this.lot}} /></:default>
 *   <:actions><Button>Close</Button></:actions>
 * </MorphingDialog>
 * ```
 *
 * WRAPS `Dialog`, so every hard part is the platform's and none of it is
 * re-implemented here: `showModal()` gives the focus trap, Escape, the top
 * layer, the `::backdrop`, and — the one every hand-rolled modal forgets —
 * focus RETURN to the trigger on close. The only thing this component adds
 * is the morph, and it adds it through the shared `morphFrom` primitive.
 *
 * Better than the inspiration (motion-primitives' MorphingDialog): upstream
 * builds the modal out of divs with a framer-motion layout animation, so it
 * ships its own focus trap, its own Escape handling, its own scroll lock and
 * a runtime — and it puts the trigger's content inside a clickable div
 * rather than a button. Here the trigger is a real `<button>` with
 * `aria-haspopup='dialog'` and `aria-expanded`, the modal is a native
 * `<dialog>`, and the whole morph is one WAAPI call with no engine at all.
 */
export class MorphingDialog extends Component<MorphingDialogSignature> {
  @tracked private internalOpen = false;
  @tracked private origin: DOMRect | undefined = undefined;
  private triggerEl?: HTMLElement;

  captureTrigger = modifier((element: HTMLElement) => {
    this.triggerEl = element;
  });

  get open(): boolean {
    return this.args.open ?? this.internalOpen;
  }

  /** `undefined` while closed, so the modifier tears the animation down on
   * close instead of replaying it. */
  get morphOrigin(): DOMRect | undefined {
    return this.open ? this.origin : undefined;
  }

  openDialog = () => {
    // Measured at CLICK time, which is the last moment the trigger is
    // guaranteed to be where the reader saw it.
    this.origin = this.triggerEl?.getBoundingClientRect();
    if (this.args.open === undefined) {
      this.internalOpen = true;
    }
    this.args.onOpenChange?.(true);
  };

  closeDialog = () => {
    if (this.args.open === undefined) {
      this.internalOpen = false;
    }
    this.args.onOpenChange?.(false);
  };

  <template>
    <div class='pretui-morph-dialog' data-test-pretui-morphing-dialog ...attributes>
      <button
        type='button'
        class='pretui-morph-trigger'
        aria-haspopup='dialog'
        aria-expanded={{if this.open 'true' 'false'}}
        data-test-pretui-morphing-dialog-trigger
        {{this.captureTrigger}}
        {{on 'click' this.openDialog}}
      >
        {{yield to='trigger'}}
      </button>

      <Dialog
        @open={{this.open}}
        @onClose={{this.closeDialog}}
        @label={{@label}}
        @size={{@size}}
        @dismissible={{@dismissible}}
        {{morphFrom this.morphOrigin}}
      >
        <:title>
          {{#if (has-block 'title')}}
            {{yield to='title'}}
          {{else}}
            {{@label}}
          {{/if}}
        </:title>
        <:default>
          <div class='pretui-morph-body'>{{yield}}</div>
          {{#if (has-block 'actions')}}
            <div class='pretui-morph-actions'>{{yield to='actions'}}</div>
          {{/if}}
        </:default>
      </Dialog>
    </div>

    <style scoped>
      .pretui-morph-dialog {
        display: contents;
      }
      .pretui-morph-trigger {
        display: block;
        inline-size: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
        border-radius: var(--radius-surface, 10px);
      }
      .pretui-morph-trigger:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-morph-body {
        color: var(--foreground);
      }
      .pretui-morph-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3, 8px);
        margin-block-start: var(--space-4, 11px);
        padding-block-start: var(--space-4, 11px);
        border-block-start: 1px solid var(--border);
      }
    </style>
  </template>
}
