// Pretui — Editable: text that reads as a value until it is a field. The
// preview is a real button whose accessible name carries the label and the
// current value; activating it swaps an Input into the same place. Enter
// commits, Escape restores, and leaving the field commits unless told
// otherwise. RecordDetail does this at form scale; this is the one-field atom.
// No timers: the focus handoff rides the render.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlNotifyArgs } from '../pretui-primitives';
import { focusWhen } from '../focus';
import { iconFor } from '../icon-registry';
import { Input } from './input';

export interface EditableSignature {
  Args: ControlNotifyArgs & {
    value?: string;
    defaultValue?: string;
    /** what the value is — "Name" — spoken as part of the trigger's name */
    label?: string;
    /** shown in the preview while the value is empty, and inside the field */
    placeholder?: string;
    disabled?: boolean;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
    /** controlled edit state; omit and use @defaultEditing */
    editing?: boolean;
    defaultEditing?: boolean;
    /** alias — Chakra's spelling of @defaultEditing */
    startWithEditView?: boolean;
    onEditingChange?: (editing: boolean) => void;
    /** fires with the committed value; onChange / onValueChange fire only when it differs */
    onSubmit?: (value: string) => void;
    onCancel?: () => void;
    /** commit when focus leaves the field (default true); false restores instead */
    submitOnBlur?: boolean;
    /** select the whole value when the field opens (default true) */
    selectOnFocus?: boolean;
  };
  Blocks: {
    /** the preview, when the value needs markup */
    preview: [value: string];
  };
  Element: HTMLDivElement;
}

// One editing session per mount of the field, however it opened: the trigger,
// a parent flipping @editing, or @defaultEditing. Install focuses the input
// and re-arms the close guard; teardown drops the draft so the next session
// starts from the current value. Input hands `...attributes` to its inner
// control, so the input may be the element itself or inside it.
const fieldSession = modifier(
  (el: HTMLElement, [select, begin, end]: [boolean, () => void, () => void]) => {
    begin();
    let field = el.matches('input, textarea')
      ? (el as HTMLInputElement)
      : el.querySelector<HTMLInputElement>('input, textarea');
    field?.focus();
    if (select) {
      field?.select();
    }
    return end;
  },
);

export class Editable extends Component<EditableSignature> {
  @tracked internalValue = this.args.defaultValue ?? '';
  @tracked internalEditing =
    firstDefined(this.args.defaultEditing, this.args.startWithEditView) ??
    false;
  /** the text being edited this session; null until the reader types */
  @tracked edited: string | null = null;
  @tracked restoreFocus = false;
  closing = false;

  get value() {
    return this.args.value ?? this.internalValue;
  }
  get draft() {
    return this.edited ?? this.value;
  }
  get editing() {
    return this.args.editing ?? this.internalEditing;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get empty() {
    return this.value === '';
  }
  get shown() {
    return this.empty ? (this.args.placeholder ?? '') : this.value;
  }
  get selectOnFocus() {
    return this.args.selectOnFocus ?? true;
  }
  get triggerLabel() {
    let what = this.args.label ? `Edit ${this.args.label}` : 'Edit';
    return this.empty ? `${what}, empty` : `${what}, currently ${this.value}`;
  }

  setEditing(next: boolean) {
    if (this.args.editing === undefined) {
      this.internalEditing = next;
    }
    this.args.onEditingChange?.(next);
  }
  open = () => {
    if (this.disabled) {
      return;
    }
    this.setEditing(true);
  };
  beginSession = () => {
    this.closing = false;
  };
  endSession = () => {
    this.edited = null;
  };
  setDraft = (value: string) => (this.edited = value);
  /** `restore` hands focus back to the trigger — Enter and Escape only; on
   *  blur, focus has already gone where the reader sent it */
  commit = (restore: boolean) => {
    if (this.closing) {
      return;
    }
    this.closing = true;
    let next = this.draft;
    let changed = next !== this.value;
    if (this.args.value === undefined) {
      this.internalValue = next;
    }
    if (changed) {
      emit([this.args.onChange, this.args.onValueChange], next);
    }
    this.args.onSubmit?.(next);
    this.close(restore);
  };
  cancel = (restore: boolean) => {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.args.onCancel?.();
    this.close(restore);
  };
  // A parent holding @editing open keeps the field mounted, so the session
  // continues and the next Enter, Escape or blur must be heard.
  close(restore: boolean) {
    this.restoreFocus = restore;
    this.setEditing(false);
    if (this.editing) {
      this.closing = false;
    }
  }
  onKeydown = (ev: Event) => {
    let key = ev as KeyboardEvent;
    // the Enter that confirms an IME candidate is not a commit
    if (key.isComposing) {
      return;
    }
    if (key.key === 'Enter') {
      ev.preventDefault();
      this.commit(true);
    } else if (key.key === 'Escape') {
      ev.preventDefault();
      this.cancel(true);
    }
  };
  onFocusout = (ev: Event) => {
    // a field leaving the DOM (teardown, a parent re-render) also blurs;
    // that is not the reader leaving the field
    if (this.isDestroying || !(ev.target as Element).isConnected) {
      return;
    }
    if (this.args.submitOnBlur ?? true) {
      this.commit(false);
    } else {
      this.cancel(false);
    }
  };
  <template>
    <div
      class='pretui-editable'
      data-editing={{if this.editing 'true' 'false'}}
      data-empty={{if this.empty 'true' 'false'}}
      data-test-pretui-editable
      ...attributes
    >
      {{#if this.editing}}
        <Input
          @value={{this.draft}}
          @placeholder={{@placeholder}}
          @disabled={{this.disabled}}
          @onInput={{this.setDraft}}
          aria-label={{@label}}
          data-test-pretui-editable-field
          {{fieldSession this.selectOnFocus this.beginSession this.endSession}}
          {{on 'keydown' this.onKeydown}}
          {{on 'focusout' this.onFocusout}}
        />
      {{else}}
        <button
          type='button'
          class='pretui-editable-trigger'
          aria-label={{this.triggerLabel}}
          disabled={{this.disabled}}
          data-test-pretui-editable-trigger
          {{focusWhen this.restoreFocus}}
          {{on 'click' this.open}}
        >
          <span class='pretui-editable-value'>
            {{#if (has-block 'preview')}}
              {{yield this.value to='preview'}}
            {{else}}
              {{this.shown}}
            {{/if}}
          </span>
          {{#let (iconFor 'pencil') as |Pencil|}}
            {{#if Pencil}}
              <Pencil class='pretui-editable-pencil' aria-hidden='true' />
            {{/if}}
          {{/let}}
        </button>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-editable {
          --ed-h: var(--control-h, 1.75rem);
          --ed-text: var(--text-ui-md, 0.78rem);
          --ed-pad: var(--space-2, 0.375rem);
          --ed-snap: var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
          display: inline-grid;
          inline-size: 100%;
          min-inline-size: 0;
          font-size: var(--ed-text);
          letter-spacing: var(--track-ui, 0.01em);
        }
        .pretui-editable-trigger {
          display: inline-flex;
          align-items: center;
          gap: var(--ed-pad);
          inline-size: 100%;
          min-block-size: var(--ed-h);
          margin: 0;
          padding-block: 0;
          padding-inline: var(--ed-pad);
          font: inherit;
          letter-spacing: inherit;
          text-align: start;
          color: inherit;
          background-color: transparent;
          border: 0;
          border-radius: var(--radius);
          box-shadow: 0 0 0 1px transparent;
          cursor: text;
          transition:
            background-color var(--ed-snap),
            box-shadow var(--ed-snap);
        }
        .pretui-editable-trigger:hover:not(:disabled) {
          background-color: var(--hover);
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-editable-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-editable-trigger:disabled {
          cursor: default;
          opacity: 0.6;
        }
        .pretui-editable-value {
          flex: 1;
          min-inline-size: 0;
          overflow-wrap: anywhere;
        }
        .pretui-editable[data-empty='true'] .pretui-editable-value {
          color: var(--muted-foreground);
        }
        .pretui-editable-pencil {
          flex: none;
          inline-size: 0.75rem;
          block-size: 0.75rem;
          color: var(--muted-foreground);
          opacity: 0;
          transition: opacity var(--ed-snap);
        }
        .pretui-editable-trigger:hover .pretui-editable-pencil,
        .pretui-editable-trigger:focus-visible .pretui-editable-pencil {
          opacity: 1;
        }
      }
    </style>
  </template>
}
