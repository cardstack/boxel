// Pretui — EditInPlace: a value that becomes its own editor in place.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { Input } from './input';
import { listen } from '../focus';
import { focusInnerOnToken, focusOnToken } from '../internal/structure-flow';

// ═════════════════════════════════════════════════════════════════════════
// EditInPlace
// ═════════════════════════════════════════════════════════════════════════
//
// From `7af9aa-blog-app/components/editable-field.gts`.
//
// **The activation decision, and why.** The upstream wrapped arbitrary
// yielded display content in `<div role='button' tabindex='0'>` and activated
// on `dblclick`. That is three defects in one line: nested interactive
// content when the display holds a link (invalid, and a screen-reader trap),
// no touch equivalent for double-click, and no visible affordance — the only
// hint was a `title` attribute, which never surfaces on touch and is
// unreliable to AT.
//
// So the guaranteed activation path here is **a real adjacent `<button>`**
// with a required accessible name ("Edit Title"), which is:
//   * keyboard-reachable by Tab, and activated by Enter or Space for free,
//     because it is a button and not an impression of one;
//   * visible on hover, on `:focus-within`, and unconditionally on coarse
//     pointers — hover is never the only affordance;
//   * safe beside display content of any shape, because it is a sibling of
//     that content rather than a wrapper around it.
// Click-anywhere is available as an *enhancement* (`@activateOn='row'`) and
// skips clicks that landed on a link or control inside the display, so it can
// never swallow the display's own interactions. It is never the only path.
//
// Better than the inspiration, otherwise:
//
//  1. **No magic timer.** The upstream used `setTimeout(…, 50)` to avoid
//     catching the click that opened the editor. Commit is driven by
//     `focusout` with a `relatedTarget` containment check — deterministic,
//     synchronous, and legal in a realm that forbids the timer outright.
//  2. **That same check fixes the premature commit.** The upstream committed
//     on any `focusout`, so moving focus to a toolbar button *inside* the
//     editor committed the edit under the reader. Here focus moving anywhere
//     within the editor is not a departure.
//  3. **Escape cancels**, which the upstream had no path for at all, and it
//     `stopPropagation`s so an enclosing dialog does not also close.
//  4. **Enter commits** — and on a multiline editor Enter inserts a newline
//     while ⌘/Ctrl-Enter commits, because the alternative is a textarea you
//     cannot put a paragraph break in.
//  5. **Touch works.** The upstream listened for `mousedown` only.
//  6. **It has a name.** The upstream had no accessible name of its own; the
//     editor here is labelled by a visually-hidden `<label for>` carrying
//     `@label`, and the mode change is announced through a polite status.
//  7. **Zero hardcoded colour.** The upstream hardcoded `#7b61ff` and two
//     rgba values; every value here is a token with a light fallback.
//  8. **An empty value still has a target.** The upstream rendered nothing
//     for an empty value, leaving no way in; `@placeholder` renders a muted
//     prompt that is part of the button's target.
//
// Deliberately NOT generic, for the reason DataComponent gives: a type
// parameter inside `Args` makes Glint infer `{}` at every call site. The
// draft is a `string`, which is what every native editor produces and what
// every kit input speaks; a caller with a non-string domain value formats on
// the way in and parses inside `onCommit`.

export type EditInPlaceActivation = 'button' | 'row';
export type EditInPlaceCommit = 'blur' | 'action';

export interface EditInPlaceEditorApi {
  /** The draft. Bind it to your control's `@value`. */
  value: string;
  /** Push a new draft. Bind to your control's change callback. */
  setValue: (next: string) => void;
  /** The id the editor's control must carry — a real `<label for>` points at it. */
  controlId: string;
  commit: () => void;
  cancel: () => void;
  invalid: boolean;
}

export interface EditInPlaceSignature {
  Args: {
    /** The committed value. */
    value?: string;
    /**
     * The field's name — required, because an unnamed editor is an unnamed
     * editor. Used for the visually-hidden label and the trigger's name.
     */
    label: string;
    /** Shown, muted, when the value is empty. Default 'Empty'. */
    placeholder?: string;
    /** Controlled edit mode. Omit and seed `@defaultEditing`. */
    editing?: boolean;
    /** Uncontrolled seed. Default false. */
    defaultEditing?: boolean;
    /** Fires whenever the mode moves, in either direction. */
    onEditingChange?: (editing: boolean) => void;
    /**
     * Fires on commit with the draft. Return `false` to refuse the commit
     * and stay in edit mode — the honest way for a caller to reject a value
     * without a validation framework.
     */
    onCommit?: (next: string) => boolean | void;
    /** Fires on Escape or an explicit Cancel. */
    onCancel?: () => void;
    /** Live draft channel, for a caller mirroring the draft elsewhere. */
    onDraftChange?: (next: string) => void;
    /** Rejected state on the editor, wired to `@error`. */
    invalid?: boolean;
    /** Message under the editor. Announced, and referenced by aria-describedby. */
    error?: string;
    /** Not editable: renders the display content bare, with no chrome at all. */
    canEdit?: boolean;
    /** Pointer convenience — 'row' also activates on a click in the display. Never the only path. */
    activateOn?: EditInPlaceActivation;
    /** 'blur' (default) commits on leaving; 'action' renders Save / Cancel and ignores blur. */
    commitOn?: EditInPlaceCommit;
    /** Enter inserts a newline; ⌘/Ctrl-Enter commits. */
    multiline?: boolean;
    /** Announce the mode change politely. Default true. */
    announce?: boolean;
    /** Wording. */
    saveLabel?: string;
    cancelLabel?: string;
  };
  Blocks: {
    /** The resting presentation. Any content — it is never wrapped in a control. */
    display: [];
    /** The editor. Receives the draft api. Omit for a Pretui `Input`. */
    editor: [EditInPlaceEditorApi];
  };
  Element: HTMLDivElement;
}

const INTERACTIVE_IN_DISPLAY =
  'a, button, input, select, textarea, summary, [role="button"], [role="link"]';

export class EditInPlace extends Component<EditInPlaceSignature> {
  private guid = guidFor(this);

  @tracked private internalEditing = this.args.defaultEditing ?? false;
  @tracked private draft = this.args.value ?? '';
  /** Increments when the editor should take focus. */
  @tracked private editToken = 0;
  /** Increments when focus should return to the trigger. */
  @tracked private restoreToken = 0;
  @tracked private mode: 'idle' | 'editing' | 'saved' | 'cancelled' = 'idle';

  get controlId(): string {
    return this.guid + '-ctl';
  }
  get errorId(): string {
    return this.guid + '-err';
  }

  get editable(): boolean {
    return this.args.canEdit ?? true;
  }
  get editing(): boolean {
    return this.editable && (this.args.editing ?? this.internalEditing);
  }
  get value(): string {
    return this.args.value ?? '';
  }
  get isEmpty(): boolean {
    return this.value.trim().length === 0;
  }
  get placeholder(): string {
    return this.args.placeholder ?? 'Empty';
  }
  get commitOn(): EditInPlaceCommit {
    return this.args.commitOn ?? 'blur';
  }
  get showActions(): boolean {
    return this.commitOn === 'action';
  }
  get activateOn(): EditInPlaceActivation {
    return this.args.activateOn ?? 'button';
  }
  get triggerLabel(): string {
    return 'Edit ' + this.args.label;
  }
  get describedBy(): string | undefined {
    return this.args.error ? this.errorId : undefined;
  }
  get announce(): boolean {
    return this.args.announce ?? true;
  }
  /**
   * The mode announcement. Empty until something has actually happened, so
   * the region is silent on mount — live regions do not announce their
   * initial content, and this one has none to announce.
   */
  get liveText(): string {
    if (!this.announce) {
      return '';
    }
    if (this.mode === 'editing') {
      return 'Editing ' + this.args.label;
    }
    if (this.mode === 'saved') {
      return this.args.label + ' saved';
    }
    if (this.mode === 'cancelled') {
      return this.args.label + ' edit cancelled';
    }
    return '';
  }

  get editorApi(): EditInPlaceEditorApi {
    return {
      value: this.draft,
      setValue: this.setDraft,
      controlId: this.controlId,
      commit: this.commit,
      cancel: this.cancel,
      invalid: Boolean(this.args.invalid),
    };
  }

  private setEditing = (next: boolean): void => {
    if (this.args.editing === undefined) {
      this.internalEditing = next;
    }
    this.args.onEditingChange?.(next);
  };

  activate = (): void => {
    if (!this.editable || this.editing) {
      return;
    }
    this.draft = this.value;
    this.mode = 'editing';
    this.editToken = this.editToken + 1;
    this.setEditing(true);
  };

  setDraft = (next: string): void => {
    this.draft = next;
    this.args.onDraftChange?.(next);
  };

  commit = (): void => {
    if (!this.editing) {
      return;
    }
    let verdict = this.args.onCommit?.(this.draft);
    if (verdict === false) {
      // Refused: stay in edit mode and put focus back where the fix is.
      this.editToken = this.editToken + 1;
      return;
    }
    this.mode = 'saved';
    this.restoreToken = this.restoreToken + 1;
    this.setEditing(false);
  };

  cancel = (): void => {
    if (!this.editing) {
      return;
    }
    this.draft = this.value;
    this.mode = 'cancelled';
    this.restoreToken = this.restoreToken + 1;
    this.args.onCancel?.();
    this.setEditing(false);
  };

  handleDraftInput = (next: string): void => {
    this.setDraft(next);
  };

  /**
   * Commit on leaving — with the containment check that is the whole fix.
   * Focus moving to a control INSIDE the editor is not a departure, so a
   * Save button, a date picker's own trigger or a toolbar inside the editor
   * no longer commit the edit out from under the reader.
   */
  handleFocusOut = (event: Event): void => {
    if (this.commitOn !== 'blur' || !this.editing) {
      return;
    }
    let host = event.currentTarget as HTMLElement | null;
    let next = (event as FocusEvent).relatedTarget as Node | null;
    if (host && next && host.contains(next)) {
      return;
    }
    this.commit();
  };

  handleKeyDown = (event: Event): void => {
    if (!this.editing) {
      return;
    }
    let key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      event.preventDefault();
      // One Escape means exactly one thing: cancel THIS edit. Without this
      // an enclosing dialog closes at the same time.
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (key.key === 'Enter') {
      let withModifier = key.metaKey || key.ctrlKey;
      if (this.args.multiline && !withModifier) {
        return;
      }
      event.preventDefault();
      this.commit();
    }
  };

  /** Pointer enhancement only — see the activation note above. */
  handleRowClick = (event: Event): void => {
    if (this.editing || this.activateOn !== 'row' || !this.editable) {
      return;
    }
    let target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_IN_DISPLAY)) {
      return;
    }
    this.activate();
  };

  <template>
    {{#if this.editable}}
      <div
        class='pretui-eip'
        data-editing={{if this.editing 'true' 'false'}}
        data-empty={{if this.isEmpty 'true' 'false'}}
        data-activate={{this.activateOn}}
        data-test-pretui-edit-in-place
        {{listen 'click' this.handleRowClick}}
        ...attributes
      >
        {{#if this.editing}}
          <div
            class='pretui-eip-editor'
            data-test-pretui-edit-in-place-editor
            {{listen 'focusout' this.handleFocusOut}}
            {{listen 'keydown' this.handleKeyDown}}
          >
            {{!--
              A real <label for>, visually hidden. The id reaches the control
              through a component ARG, never a template attribute — which is
              also what keeps require-input-label satisfied.
            --}}
            <label class='pretui-sr' for={{this.controlId}}>{{@label}}</label>
            <div
              class='pretui-eip-control'
              {{focusInnerOnToken this.editToken}}
            >
              {{#if (has-block 'editor')}}
                {{yield this.editorApi to='editor'}}
              {{else}}
                <Input
                  @value={{this.draft}}
                  @controlId={{this.controlId}}
                  @invalid={{@invalid}}
                  @onInput={{this.handleDraftInput}}
                  aria-describedby={{this.describedBy}}
                  data-test-pretui-edit-in-place-input
                />
              {{/if}}
            </div>
            {{#if this.showActions}}
              <div class='pretui-eip-actions'>
                <Button
                  @tone='neutral'
                  @appearance='plain'
                  data-test-pretui-edit-in-place-cancel
                  {{on 'click' this.cancel}}
                >{{if @cancelLabel @cancelLabel 'Cancel'}}</Button>
                <Button
                  @tone='primary'
                  @appearance='accent'
                  data-test-pretui-edit-in-place-save
                  {{on 'click' this.commit}}
                >{{if @saveLabel @saveLabel 'Save'}}</Button>
              </div>
            {{/if}}
            {{!-- Reserved line, so an error arriving does not shift the row. --}}
            <p
              class='pretui-eip-error'
              id={{this.errorId}}
              data-test-pretui-edit-in-place-error
            >{{@error}}</p>
          </div>
        {{else}}
          <div class='pretui-eip-display' data-test-pretui-edit-in-place-display>
            {{#if this.isEmpty}}
              <span class='pretui-eip-placeholder'>{{this.placeholder}}</span>
            {{else}}
              {{yield to='display'}}
            {{/if}}
          </div>
          <button
            type='button'
            class='pretui-eip-trigger'
            aria-label={{this.triggerLabel}}
            data-test-pretui-edit-in-place-trigger
            {{focusOnToken this.restoreToken}}
            {{on 'click' this.activate}}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              aria-hidden='true'
              focusable='false'
            ><path
                d='M8.1 1.6 10.4 3.9 4.3 10H2v-2.3ZM7 2.7l2.3 2.3'
                fill='none'
                stroke='currentColor'
                stroke-width='1.2'
                stroke-linecap='round'
                stroke-linejoin='round'
              /></svg>
          </button>
        {{/if}}
        <span
          class='pretui-sr'
          role='status'
          data-test-pretui-edit-in-place-live
        >{{this.liveText}}</span>
      </div>
    {{else}}
      {{!--
        Not editable renders the content BARE — no wrapper, no dead
        affordance, nothing for a reader to try. The upstream got this right
        and it is worth keeping.
      --}}
      {{yield to='display'}}
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-eip {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          min-width: 0;
          position: relative;
          border-radius: var(--radius);
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
        }
        .pretui-eip[data-editing='true'] {
          display: block;
        }
        .pretui-eip[data-activate='row'][data-editing='false'] {
          cursor: pointer;
        }
        /* min-width: 0 on every flex child — the fix for the overflow blowout
           a long value otherwise causes. */
        .pretui-eip-display {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-eip-placeholder {
          color: var(--ink-3, var(--boxel-400));
          font-style: italic;
        }
        .pretui-eip-trigger {
          display: inline-grid;
          place-items: center;
          flex: none;
          width: 1.55em;
          height: 1.55em;
          padding: 0;
          border: 0;
          border-radius: var(--pretui-radius-encroach, 6px);
          background: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
          opacity: 0;
          transition: opacity var(--pretui-dur-snap, 180ms)
              var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1)),
            background var(--pretui-dur-snap, 180ms)
              var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        /* Revealed by hover AND by focus-within, so the affordance can never
           become an invisible focus stop — the trap the catalog's own
           hover-overlay component fell into. */
        .pretui-eip:hover .pretui-eip-trigger,
        .pretui-eip:focus-within .pretui-eip-trigger {
          opacity: 1;
        }
        .pretui-eip-trigger:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-eip-trigger:focus-visible {
          opacity: 1;
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* Hover is never the only affordance: a coarse pointer has none, so
           the control is simply always there, at a real hit target. */
        @media (any-pointer: coarse) {
          .pretui-eip-trigger {
            opacity: 1;
            min-width: 44px;
            min-height: 44px;
          }
        }
        .pretui-eip-editor {
          display: grid;
          gap: var(--space-2, 6px);
          min-width: 0;
        }
        /* The control wrapper is only the focus LANDING SITE — the modifier
           reaches through it to the real control, so the wrapper itself never
           holds focus and never needs a ring. */
        .pretui-eip-control {
          min-width: 0;
        }
        .pretui-eip-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-2, 6px);
        }
        .pretui-eip-error {
          margin: 0;
          min-height: 1.25em;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-eip-trigger {
            transition: none;
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
      }
    </style>
  </template>
}
