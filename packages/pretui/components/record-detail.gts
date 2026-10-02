// Pretui — RecordDetail: a record page where each field edits in place and a footer saves the batch.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { hash } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { IconButton } from './icon-button';
import { Label } from './label';
import { Tooltip } from './tooltip';
import { Alert } from './alert';
import { iconFor } from '../icon-registry';
import { focusWhen, listen } from '../focus';
import { isBlocking, issuesForPath, sortIssues } from '../internal/forms-core';
import type { FormIssue } from '../internal/forms-core';
import { CompoundField } from './compound-field';
import { FormFooter } from './form-footer';
import { displayText, plural, severityOf, showTrigger } from '../internal/forms-record';
import type { ContextualComponent, RecordBatchApi, RecordEditContext, RecordLayout } from '../internal/forms-record';

// ── RecordDetail's Field ─────────────────────────────────────────────────
//
// Ported from SLDS `RecordDetailField` + `FormElement` + `FormElementStatic`
// (`slds-form-element_edit`, `__static`, `__undo`, `slds-is-editing`,
// `slds-is-edited`).
//
// BETTER THAN THE INSPIRATION:
//   • THE STATIC VALUE IS THE BUTTON. SLDS renders the value in a plain
//     <div class="slds-form-element__static"> and hangs a separate pencil
//     ButtonIcon beside it, so clicking the value does nothing and the field
//     costs two tab stops. Ours makes the static row a real <button> with
//     `aria-labelledby="{label} {value}"` — the screen reader hears the
//     field name AND its current value, Enter/Space opens the editor, and a
//     field is one tab stop.
//   • ESCAPE EXISTS. SLDS ships no cancel path whatsoever. Escape here
//     closes the editor, discards only the in-flight keystrokes, leaves this
//     field's already-committed edit and every other field's untouched, and
//     returns focus to the static trigger.
//   • A POINTER CANCEL PATH. Keyboard users get Escape; SLDS gives pointer
//     users nothing. The editor row carries a discard control whose
//     mousedown is prevented, so it cannot be commit-on-blur'd out from
//     under the click.
//   • `slds-is-edited` is a hardcoded `$color-background-highlight` yellow
//     with no token chain and no story for a re-themed season; its undo
//     button is positioned with a negative magic number
//     (`top: -$square-icon-utility-medium`). Ours tints with `color-mix()`
//     off the theme's own `--warning` and puts undo in flow.
//   • The required marker: SLDS's only required signal is
//     `<abbr class="slds-required" aria-hidden="true">*</abbr>` — invisible
//     to assistive tech. Ours keeps the abbr for sighted parity and adds an
//     sr-only "(required)".
//   • Responsive: SLDS's horizontal form pins a fixed label column that
//     never collapses. Ours folds label-over-value on a real container
//     query, measured on the FIELD.
//
// DROPPED FROM UPSTREAM (and why): `avatar` / `link` / `timestamp` value
// props — an avatar or a link is a rendering decision, so it belongs in the
// `<:display>` block (Law 7); the `column` (`slds-form-element_N-col`)
// modifier classes — grid auto-placement plus `@span` covers the same ground
// without a class per count; the `isDeprecated` legacy `slds-form_stacked`
// fork; and the help Tooltip's hand-positioned pixel offsets — the kit's
// Tooltip does its own positioning.
export interface RecordFieldSignature {
  Args: {
    /** Supplied by RecordDetail through the yielded contextual component.
     *  Never pass this by hand. */
    api?: RecordBatchApi;
    /** BXL label path. This is the string an issue's `targetPath` must
     *  EQUAL — quoted exactly as the guide rule wrote it. Required. */
    path: string;
    /** Human label for the field. Required. */
    label: string;
    /** The SAVED value. RecordDetail holds the pending edit separately, so
     *  this arg stays whatever the record currently has — which is the only
     *  reason undo has somewhere to go back to. */
    value?: unknown;
    /** Marks the field required: an asterisk plus an sr-only "(required)".
     *  Purely presentational — requiredness is enforced by a guide rule,
     *  never by this component. */
    required?: boolean;
    /** Help text revealed from a small info control beside the label. */
    help?: string;
    /** Suppress the pencil for this field only. */
    readOnly?: boolean;
    /** Render the static value as running text (SLDS `slds-text-longform`)
     *  instead of one clamped line — for textarea-shaped fields. */
    longform?: boolean;
    /** What to show when the value is empty. @default the record's '—' */
    placeholder?: string;
    /** 'full' makes the field span every column of the record grid.
     *  @default 'auto' */
    span?: 'auto' | 'full';
  };
  Blocks: {
    /** Custom static rendering — the avatar, link, Chip or formatted number
     *  SLDS spent three props on. Yields the currently shown value. */
    display: [value: unknown];
    /** The editor control. Omit it and the field is read-only: no pencil,
     *  no button — honest about being uneditable rather than flagged so. */
    editor: [RecordEditContext];
  };
  Element: HTMLDivElement;
}

/** Stand-in so a Field rendered outside a RecordDetail degrades to a
 *  read-only display instead of throwing. */
const NO_BATCH: RecordBatchApi = {
  readOnly: true,
  layout: 'stacked',
  placeholder: '—',
  editingPath: null,
  lastClosed: null,
  scratch: undefined,
  issuesFor: () => [],
  isDirty: () => false,
  committed: (_path: string, saved: unknown) => saved,
  open: () => undefined,
  setScratch: () => undefined,
  close: () => undefined,
  discard: () => undefined,
  undo: () => undefined,
};

class RecordField extends Component<RecordFieldSignature> {
  labelId = `${guidFor(this)}-lbl`;
  valueId = `${guidFor(this)}-val`;
  controlId = `${guidFor(this)}-ctl`;
  hintId = `${guidFor(this)}-hint`;
  msgId = `${guidFor(this)}-msg`;

  get api(): RecordBatchApi {
    return this.args.api ?? NO_BATCH;
  }
  get layout(): RecordLayout {
    return this.api.layout;
  }
  get placeholder(): string {
    return this.args.placeholder ?? this.api.placeholder;
  }
  get editable(): boolean {
    return !this.args.readOnly && !this.api.readOnly;
  }
  get isEditing(): boolean {
    return this.api.editingPath === this.args.path;
  }
  get isDirty(): boolean {
    return this.api.isDirty(this.args.path);
  }
  /** True on the render where this field's editor closed by an EXPLICIT
   *  gesture (Enter or Escape) — the one render where focus travels back to
   *  the static trigger. A blur-out never sets it: the user is already on
   *  their way somewhere else and must not be yanked back. */
  get shouldRestoreFocus(): boolean {
    return this.api.lastClosed === this.args.path;
  }
  get issues(): FormIssue[] {
    return this.api.issuesFor(this.args.path);
  }
  get invalid(): boolean {
    return this.issues.some(isBlocking);
  }
  get describedBy(): string {
    return this.issues.length ? `${this.hintId} ${this.msgId}` : this.hintId;
  }
  get labelledBy(): string {
    return `${this.labelId} ${this.valueId}`;
  }
  /** What the STATIC row shows: the pending edit when there is one,
   *  otherwise what the record holds. */
  get shownValue(): unknown {
    return this.api.committed(this.args.path, this.args.value);
  }
  get shownText(): string {
    return displayText(this.shownValue, this.placeholder);
  }
  get isEmpty(): boolean {
    return this.shownText === this.placeholder;
  }
  /** The in-flight value while this field's editor is open. */
  get scratchValue(): unknown {
    return this.isEditing ? this.api.scratch : this.shownValue;
  }
  get undoLabel(): string {
    return `Undo edit to ${this.args.label}`;
  }
  get discardLabel(): string {
    return `Discard edit to ${this.args.label}`;
  }
  get helpLabel(): string {
    return `Help for ${this.args.label}`;
  }
  // a field with no <:editor> block renders no trigger, so it is read-only too
  hintText = (hasEditor: boolean): string => {
    let base =
      this.editable && hasEditor
        ? 'Editable field. Press Enter to edit.'
        : 'Read only.';
    return this.isDirty ? `${base} Unsaved change.` : base;
  };
  get state(): string {
    if (this.isEditing) {
      return 'editing';
    }
    return this.isDirty ? 'edited' : 'rest';
  }

  openEditor = (_event: Event) => {
    this.api.open(this.args.path, this.args.value);
  };
  undo = (_event: Event) => {
    this.api.undo(this.args.path);
  };
  setScratch = (value: unknown) => {
    this.api.setScratch(value);
  };
  commit = () => {
    this.api.close(this.args.path, true);
  };
  cancel = () => {
    this.api.discard(this.args.path, true);
  };
  cancelFromPointer = (_event: Event) => {
    this.pointerOverDiscard = false;
    this.api.discard(this.args.path, true);
  };

  /** Guards the discard control against being commit-on-blur'd out from
   *  under the click. The obvious fix — preventDefault on mousedown — is a
   *  pointer-DOWN binding, which this codebase lints against, so instead we
   *  note that the pointer is sitting on the discard control and let
   *  `onEditorFocusOut` stand down. Deliberately NOT tracked: it is read
   *  only inside an event handler, so making it reactive would buy a
   *  re-render for nothing. (Browsers that focus a button on mousedown are
   *  already covered by the `wrap.contains(relatedTarget)` test; Safari,
   *  which does not, needs this.) */
  pointerOverDiscard = false;
  discardPointerIn = (_event: Event) => {
    this.pointerOverDiscard = true;
  };
  discardPointerOut = (_event: Event) => {
    this.pointerOverDiscard = false;
  };

  // One delegated listener per open editor (structure-data's `listen`), so
  // no {{on}} lands on a non-interactive wrapper (lint: no-invalid-interactive).
  onEditorKeydown = (event: Event) => {
    let e = event as KeyboardEvent;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key === 'Enter') {
      // A composite that owns Enter (an open listbox, a textarea) has
      // already claimed it; never steal a newline or a selection.
      let target = e.target as HTMLElement | null;
      if (e.defaultPrevented || (target && target.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      this.commit();
    }
  };
  /** Commit when focus leaves the editor entirely — the Lightning
   *  behaviour. A `relatedTarget` inside the wrapper (a Select's in-place
   *  dropdown, the discard control) is not a departure. */
  onEditorFocusOut = (event: Event) => {
    if (this.pointerOverDiscard) {
      return;
    }
    let e = event as FocusEvent;
    let wrap = e.currentTarget as HTMLElement | null;
    let next = e.relatedTarget as Node | null;
    if (wrap && next && wrap.contains(next)) {
      return;
    }
    this.api.close(this.args.path, false);
  };

  get editContext(): RecordEditContext {
    return {
      value: this.scratchValue,
      controlId: this.controlId,
      set: this.setScratch,
      commit: this.commit,
      cancel: this.cancel,
      invalid: this.invalid,
      focus: focusWhen,
    };
  }

  <template>
    <div
      class='pretui-rd-field'
      data-layout={{this.layout}}
      data-state={{this.state}}
      data-span={{if @span @span 'auto'}}
      data-invalid={{if this.invalid 'true'}}
      data-test-pretui-record-field={{@path}}
      ...attributes
    >
      <div class='pretui-rd-inner'>
        <div class='pretui-rd-labelcol'>
          {{#if this.isEditing}}
            <Label @tag='label' @for={{this.controlId}} id={{this.labelId}}>
              {{@label}}{{#if @required}}<abbr
                  class='pretui-rd-req'
                  title='required'
                  aria-hidden='true'
                >*</abbr><span class='pretui-rd-sr'>(required)</span>{{/if}}
            </Label>
          {{else}}
            {{! SLDS swaps <label for> for a plain span in view mode, because
                in view mode there is no control to point at. Same here. }}
            <Label @tag='span' id={{this.labelId}}>
              {{@label}}{{#if @required}}<abbr
                  class='pretui-rd-req'
                  title='required'
                  aria-hidden='true'
                >*</abbr><span class='pretui-rd-sr'>(required)</span>{{/if}}
            </Label>
          {{/if}}
          {{#if @help}}
            <Tooltip @content={{@help}} @side='top'>
              <button
                type='button'
                class='pretui-rd-help'
                aria-label={{this.helpLabel}}
              >?</button>
            </Tooltip>
          {{/if}}
        </div>

        <div class='pretui-rd-body'>
          {{#if this.isEditing}}
            <div
              class='pretui-rd-editor'
              data-test-pretui-record-editor
              {{listen 'keydown' this.onEditorKeydown}}
              {{listen 'focusout' this.onEditorFocusOut}}
            >
              <div class='pretui-rd-editorslot'>
                {{yield this.editContext to='editor'}}
              </div>
              <IconButton
                @label={{this.discardLabel}}
                @variant='ghost'
                class='pretui-rd-act'
                {{on 'pointerenter' this.discardPointerIn}}
                {{on 'pointerleave' this.discardPointerOut}}
                {{on 'click' this.cancelFromPointer}}
                data-test-pretui-record-discard
              >✕</IconButton>
            </div>
          {{else if (showTrigger this.editable (has-block 'editor'))}}
            <button
              type='button'
              class='pretui-rd-static pretui-rd-trigger'
              data-empty={{if this.isEmpty 'true'}}
              data-longform={{if @longform 'true'}}
              aria-labelledby={{this.labelledBy}}
              aria-describedby={{this.describedBy}}
              {{focusWhen this.shouldRestoreFocus}}
              {{on 'click' this.openEditor}}
              data-test-pretui-record-trigger
            >
              <span class='pretui-rd-value' id={{this.valueId}}>
                {{#if (has-block 'display')}}
                  {{yield this.shownValue to='display'}}
                {{else}}
                  {{this.shownText}}
                {{/if}}
              </span>
              {{#let (iconFor 'pencil') as |Pencil|}}
                {{#if Pencil}}
                  <Pencil class='pretui-rd-pencil' aria-hidden='true' />
                {{/if}}
              {{/let}}
            </button>
          {{else}}
            {{! No <:editor> block, or read-only: no affordance at all. }}
            <div
              class='pretui-rd-static'
              data-empty={{if this.isEmpty 'true'}}
              data-longform={{if @longform 'true'}}
              aria-describedby={{this.describedBy}}
            >
              <span class='pretui-rd-value' id={{this.valueId}}>
                {{#if (has-block 'display')}}
                  {{yield this.shownValue to='display'}}
                {{else}}
                  {{this.shownText}}
                {{/if}}
              </span>
            </div>
          {{/if}}

          {{#if this.isDirty}}
            <IconButton
              @label={{this.undoLabel}}
              @variant='ghost'
              class='pretui-rd-act'
              {{on 'click' this.undo}}
              data-test-pretui-record-undo
            >
              {{#let (iconFor 'DiagonalArrowLeftUp') as |UndoIcon|}}
                {{#if UndoIcon}}
                  <UndoIcon class='pretui-rd-actglyph' aria-hidden='true' />
                {{else}}
                  ↺
                {{/if}}
              {{/let}}
            </IconButton>
          {{/if}}
        </div>

        <span class='pretui-rd-sr' id={{this.hintId}}>{{this.hintText (has-block 'editor')}}</span>

        {{#if this.issues.length}}
          <div
            class='pretui-rd-msgs'
            id={{this.msgId}}
            data-test-pretui-record-issues
          >
            {{#each this.issues as |issue|}}
              <p
                class='pretui-rd-msg'
                data-severity={{severityOf issue}}
              ><span class='pretui-rd-mark'>{{severityOf issue}}</span><span
                  class='pretui-rd-msgbody'
                >{{issue.message}}</span></p>
            {{/each}}
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* above IconButton's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* The field is its own container, so label-beside-value collapses on
           the width of THIS field. The queries at the bottom of this sheet
           therefore target .pretui-rd-inner, a DESCENDANT — an unnamed query
           never matches its own container. (SLDS uses
           `@media (max-width: 304px)` and admits in a source comment that it
           is mimicking a container query.) */
        .pretui-rd-field {
          container-type: inline-size;
          min-width: 0;
          /* both knobs exist so CompoundField can flatten a nested field
             without any CSS reaching across a component boundary */
          padding: var(--pretui-record-fieldpad, 5px 0 8px);
          border-radius: var(--radius-chip, 6px);
          box-shadow: 0 1px 0 var(--pretui-record-rule, var(--border));
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-rd-field[data-span='full'] {
          grid-column: 1 / -1;
        }
        /* SLDS: a flat `background: $color-background-highlight` yellow with
           no token chain. Here the dirty tint is mixed from the theme's own
           warning hue against the card, so it survives a re-themed season. */
        /* Two field states, two DIFFERENT channels — not one channel in two
           hues. Before this, edited and invalid were both a 2px inset rule
           plus a tint and were told apart by hue alone, so in greyscale (and
           for a red/green-blind reader) they were the same mark.

             `edited` is a WASH. You touched this; it is not wrong. A
             luminance change across the whole field reads at a glance and
             needs no rule of its own.
             `invalid` is a RULE. This blocks. Geometry, not colour, is what
             says so — which also makes a rule mean exactly one thing in this
             component, so the two states can never be confused even when both
             are true.

           The wash keeps the warning hue mixed against the card so it still
           re-tints with a season; the hue is confirmation, not the signal. */
        .pretui-rd-field[data-state='edited'] {
          background: color-mix(
            in oklch,
            var(--warning, var(--boxel-warning)) var(--pretui-record-edited-mix, 9%),
            var(--card)
          );
        }
        .pretui-rd-field[data-invalid='true'] {
          box-shadow: inset 2px 0 0 var(--destructive),
            0 1px 0 var(--pretui-record-rule, var(--border));
          padding-inline-start: var(--space-3, 8px);
        }

        .pretui-rd-inner {
          display: grid;
          gap: 2px;
          align-content: start;
          min-width: 0;
        }
        .pretui-rd-labelcol {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .pretui-rd-req {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          margin-inline-start: 2px;
          text-decoration: none;
        }
        .pretui-rd-help {
          width: 14px;
          height: 14px;
          flex: none;
          display: grid;
          place-items: center;
          border: 0;
          padding: 0;
          border-radius: 50%;
          cursor: help;
          font-family: inherit;
          font-size: 9px;
          font-weight: 700;
          color: var(--muted-foreground);
          background: var(--inset, var(--boxel-100));
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-rd-help:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }

        .pretui-rd-body {
          display: flex;
          align-items: flex-start;
          gap: var(--space-2, 5px);
          min-width: 0;
        }

        /* The static row IS the trigger — one tab stop, and its accessible
           name is the label plus the value (SLDS leaves the value out of the
           edit button's name entirely).

           GEOMETRY IS RESERVED, NOT REDRAWN. The static row occupies exactly
           the box the editor control will occupy: the kit's control height,
           and a text inset equal to the control's hairline plus its inner
           padding (1px + 9px on a boxel-ui-backed Input, 0 + 10px on a Pretui
           face). It used to be a 24px box inset 5px, so clicking a field moved
           its value 5px right and 2.5px down and pushed every row beneath it
           down 5.3px — the still-frame test failed on the one frame the user
           is looking hardest at. Now nothing about the row's geometry changes
           when it flips to edit; only its dress does — measured in a browser,
           opening one field moves every getBoundingClientRect on the form by
           exactly 0.

           The inset is spent as PADDING rather than as a transparent border,
           deliberately: forced-colors mode forces border-color to a system
           colour, so a reserved transparent border would paint a real box
           around every read-only value in high contrast. Padding has no
           colour to force. */
        .pretui-rd-static {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          min-height: var(--control-h, 28px);
          padding: var(--pretui-record-staticpad, 4px 10px);
          border: 0;
          border-radius: var(--radius-chip, 6px);
          background: transparent;
          text-align: start;
          font-family: inherit;
          font-size: var(--text-ui-md, 12.5px);
          line-height: 18px;
          color: var(--card-foreground);
        }
        .pretui-rd-trigger {
          cursor: pointer;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-rd-trigger:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-rd-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-rd-static[data-empty='true'] .pretui-rd-value {
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-rd-value {
          flex: 1 1 auto;
          min-width: 0;
          display: block;
          overflow-wrap: anywhere;
        }
        /* SLDS's `.slds-text-longform` — running text keeps its wraps; a plain
           value stays on one line and truncates. */
        .pretui-rd-static:not([data-longform='true']) .pretui-rd-value {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-rd-static[data-longform='true'] .pretui-rd-value {
          white-space: pre-wrap;
        }
        .pretui-rd-pencil {
          width: 12px;
          height: 12px;
          flex: none;
          opacity: 0;
          color: var(--muted-foreground);
          transition: opacity var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-rd-trigger:hover .pretui-rd-pencil,
        .pretui-rd-trigger:focus-visible .pretui-rd-pencil {
          opacity: 1;
        }
        /* Law 5 / the screenshot test: the pencil is a hover REVEAL, so behind
           reduced-motion it simply rests visible — the END state, never a
           frozen midpoint. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-rd-pencil {
            opacity: 0.55;
            transition: none;
          }
          .pretui-rd-field,
          .pretui-rd-trigger {
            transition: none;
          }
        }

        .pretui-rd-editor {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: flex-start;
          gap: var(--space-2, 5px);
        }
        .pretui-rd-editorslot {
          flex: 1 1 auto;
          min-width: 0;
        }
        /* No optical nudge here. The discard/undo control is the kit's 28px
           IconButton, which is already exactly as tall as the control beside
           it; the old 1px top margin pushed it 1px past the control's
           bottom edge and made the whole editor row 29px against a 28px static
           row — the last pixel of the view/edit shift. */
        .pretui-rd-act {
          flex: none;
        }
        .pretui-rd-actglyph {
          width: 12px;
          height: 12px;
        }

        .pretui-rd-msgs {
          display: grid;
          gap: 1px;
          padding-inline: 5px;
        }
        /* The severity notation — the same treatment the expression builders
           uses, so a field message and an expression issue about the same
           thing read as one system. Severity is typeset: the state's own name
           in the eyebrow treatment against a fixed gutter, the hue on that
           word alone, the message itself at full --foreground contrast.
           Printing a whole sentence in --destructive never made it more
           legible; it only made it the kit's thinnest AA margin. */
        .pretui-rd-msg {
          margin: 0;
          display: grid;
          grid-template-columns: var(--pretui-rd-notegutter, 4.75em) minmax(0, 1fr);
          column-gap: var(--space-2, 6px);
          align-items: baseline;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 15px;
          color: var(--foreground);
        }
        .pretui-rd-mark {
          justify-self: end;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          white-space: nowrap;
          color: var(--muted-foreground);
        }
        /* The hue is anchored in ink, never used raw — mixing toward
           --foreground is what makes one declaration correct in both modes
           and every season, and it is what keeps a bold 11px mark above AA
           when the raw --warning token is about 2:1 on --card. */
        .pretui-rd-msg[data-severity='error'] .pretui-rd-mark {
          color: color-mix(
            in oklch,
            var(--destructive) var(--pretui-note-hue-mix, 45%),
            var(--foreground)
          );
        }
        .pretui-rd-msg[data-severity='warning'] .pretui-rd-mark {
          color: color-mix(
            in oklch,
            var(--warning, var(--boxel-warning)) var(--pretui-note-hue-mix, 45%),
            var(--foreground)
          );
        }
        .pretui-rd-msgbody {
          min-width: 0;
        }

        .pretui-rd-sr {
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

        /* Horizontal layout: SLDS pins a fixed label column and never
           collapses it. Ours is a real two-track grid that folds back to
           stacked when the FIELD gets narrow. */
        .pretui-rd-field[data-layout='horizontal'] .pretui-rd-inner {
          grid-template-columns: minmax(5rem, 11rem) minmax(0, 1fr);
          column-gap: var(--space-4, 11px);
          align-items: start;
        }
        .pretui-rd-field[data-layout='horizontal'] .pretui-rd-labelcol {
          padding-top: 4px;
        }
        .pretui-rd-field[data-layout='horizontal'] .pretui-rd-msgs {
          grid-column: 2;
        }
        @container (max-width: 22rem) {
          .pretui-rd-field[data-layout='horizontal'] .pretui-rd-inner {
            grid-template-columns: minmax(0, 1fr);
          }
          .pretui-rd-field[data-layout='horizontal'] .pretui-rd-labelcol {
            padding-top: 0;
          }
          .pretui-rd-field[data-layout='horizontal'] .pretui-rd-msgs {
            grid-column: 1;
          }
        }
      }
    </style>
  </template>
}
// ── RecordDetail ─────────────────────────────────────────────────────────
//
// Ported from SLDS `form-element/record-detail` (`.slds-form`,
// `.slds-form__row`, `.slds-form__item`, `.slds-is-edited`,
// `.slds-form-element__undo`).
//
// THE BATCHED-SAVE STATE MACHINE — three layers, and this is the whole
// design:
//
//   saved    the `@value` each field is handed. Never mutated here; the
//            host owns it. Undo is only possible because we never touch it.
//   draft    committed-but-unsaved per-field edits, one entry per path.
//            This is SLDS's `slds-is-edited`, and it is what the footer
//            counts and what @onSave receives.
//   scratch  the in-flight value of the ONE open editor, before it commits.
//            At most one exists, because at most one editor is open.
//
//   open       scratch ← draft[path] ?? saved
//   type       scratch ← keystroke                (draft untouched)
//   Enter      draft[path] ← scratch; editor closes; focus returns to the
//              trigger
//   blur-out   same commit, but focus is NOT restored — the user is already
//              on their way somewhere else
//   Escape     scratch dropped; editor closes; focus returns to the trigger.
//              draft[path] SURVIVES, and so does every other field's entry
//   undo       draft[path] deleted; the field snaps back to saved
//   Save       @onSave(draft); the draft clears optimistically and the host
//              hands back new @values
//   Cancel     scratch AND the whole draft dropped; every field returns to
//              saved
//
//   A HALF-EDITED FIELD ON CANCEL: its keystrokes go with everything else.
//   Two routes reach the same place — if focus leaves the editor on the way
//   to the Cancel button, the blur commits the scratch into the draft first,
//   and `cancelAll` then clears the entry it just made; if it does not, the
//   scratch is dropped directly. Either way nothing survives Cancel.
//
// BETTER THAN THE INSPIRATION:
//   • SLDS ships no state machine at all. `isEdited` is a literal in a
//     snapshot data file, the undo button does nothing, there is no dirty
//     count and no save wiring. The pattern is drawn but not built. Ours is
//     the working machine, and it is the reason this component exists.
//   • Rows: SLDS makes you hand-author `<div class="slds-form__row">`
//     wrappers and pass a `column` count per field. Ours is grid
//     auto-placement plus a per-field `@span` — no wrapper elements, no
//     class per column count.
//   • Responsiveness: `.slds-form__item` uses `min-width: 280px` on a
//     wrapping flexbox "to mimic container query" (their words) and then a
//     `@media (max-width: 304px)`. In a Boxel card a viewport query measures
//     the browser window, not the pane the card is in. Ours is a real
//     unnamed container query on the record itself.
//   • SLDS never surfaces an issue that belongs to no rendered field. Ours
//     renders a form-level summary, so an issue cannot be swallowed.
//
// DROPPED FROM UPSTREAM (and why): `snapshot` (a data-object API — blocks
// are how a Glimmer form takes its fields, and the editor MUST be a slot);
// the `isDeprecated` / `slds-form_stacked|horizontal` legacy fork;
// `isViewMode` as a separate mode — a field with no `<:editor>` block, or
// `@readOnly`, IS view mode and says so structurally instead of by flag; and
// `role='list'` / `role='listitem'` on the form and its items, because a
// compound `<fieldset>` is not a valid child of a list and the label/value
// pairing already carries the structure.
//
// HONEST LIMIT (Law 7 — name the unfinished edge rather than hide it): the
// issue summary lists EVERY issue, not only the ones matching no rendered
// field. Knowing which paths were rendered would require the fields to
// register themselves with the parent during render, which is exactly the
// render-phase mutation Ember asserts on. A complete list is the fail-safe
// choice: it cannot drop an error. Pass @summary={{false}} when the host
// renders its own.
export interface RecordDetailSignature {
  Args: {
    /** Already-computed issues for the whole record, from BXL guide rules.
     *  Routed to fields by whole-string `targetPath` equality; nothing here
     *  evaluates, parses or splits a path. */
    issues?: FormIssue[];
    /** Columns at full width; folds to fewer as the record narrows. Clamped
     *  to 1–4. @default 2 */
    columns?: number;
    /** 'stacked' puts each label above its value (the Salesforce default);
     *  'horizontal' puts it beside. @default 'stacked' */
    layout?: RecordLayout;
    /** Turns every field read-only at once — no pencils anywhere. */
    readOnly?: boolean;
    /** Text shown for an empty value. @default '—' */
    placeholder?: string;
    /** Receives the batch as `{ [path]: value }` when the footer saves. The
     *  host writes it and hands back new `@value`s; the draft clears
     *  optimistically the moment this fires. */
    onSave?: (changes: Record<string, unknown>) => void;
    /** Fired after the batch is discarded. */
    onCancel?: () => void;
    /** Save is in flight — the footer locks. */
    saving?: boolean;
    /** Suppress the built-in docked footer; drive your own FormFooter from
     *  the yielded `state` instead. */
    hideFooter?: boolean;
    /** Suppress the form-level issue summary. @default true (shown) */
    summary?: boolean;
  };
  Blocks: {
    /** Yields `{ Field, Compound, state }`. `Field` and `Compound` come
     *  pre-bound to this record's batch and issues; `state` is
     *  `{ dirtyCount, dirtyPaths, editingPath, save, cancel }` for a custom
     *  footer or a header badge. */
    default: [
      {
        Field: ContextualComponent;
        Compound: ContextualComponent;
        state: RecordDetailState;
      },
    ];
  };
  Element: HTMLDivElement;
}

/** The batch, as seen from outside. */
export interface RecordDetailState {
  /** How many fields carry a committed-but-unsaved edit. */
  dirtyCount: number;
  /** Which paths those are. */
  dirtyPaths: string[];
  /** The path whose editor is open, if any. */
  editingPath: string | null;
  /** Commit the batch (what the footer's Save calls). */
  save: () => void;
  /** Discard the batch (what the footer's Cancel calls). */
  cancel: () => void;
}

export class RecordDetail extends Component<RecordDetailSignature> {
  /** committed-but-unsaved edits. Replaced wholesale on write, so the
   *  tracked read stays a plain property read — no TrackedMap needed. */
  @tracked draft: Record<string, unknown> = {};
  /** the one open editor's path, or null */
  @tracked editingPath: string | null = null;
  /** the one open editor's in-flight value */
  @tracked scratch: unknown = undefined;
  /** the path whose editor closed by an EXPLICIT gesture — the single
   *  render where focus travels back to that field's trigger */
  @tracked lastClosed: string | null = null;

  get columns(): number {
    let n = this.args.columns ?? 2;
    return Math.min(4, Math.max(1, Math.round(n)));
  }
  get layout(): RecordLayout {
    return this.args.layout === 'horizontal' ? 'horizontal' : 'stacked';
  }
  get placeholder(): string {
    return this.args.placeholder ?? '—';
  }
  get dirtyPaths(): string[] {
    return Object.keys(this.draft);
  }
  get dirtyCount(): number {
    return this.dirtyPaths.length;
  }
  get summaryIssues(): FormIssue[] {
    return sortIssues(this.args.issues ?? []);
  }
  get showSummary(): boolean {
    return this.args.summary !== false && this.summaryIssues.length > 0;
  }
  get summaryTone(): 'info' | 'success' | 'warning' | 'danger' {
    let worst = this.summaryIssues[0];
    if (!worst) {
      return 'info';
    }
    if (isBlocking(worst)) {
      return 'danger';
    }
    return worst.severity === 'warning' ? 'warning' : 'info';
  }
  get summaryTitle(): string {
    let n = this.summaryIssues.length;
    return `${n} ${plural(n, 'issue', 'issues')} on this record`;
  }

  // ── the batch API handed to every field ───────────────────────────────
  get api(): RecordBatchApi {
    return {
      readOnly: Boolean(this.args.readOnly),
      layout: this.layout,
      placeholder: this.placeholder,
      editingPath: this.editingPath,
      lastClosed: this.lastClosed,
      scratch: this.scratch,
      issuesFor: this.issuesFor,
      isDirty: this.isDirty,
      committed: this.committed,
      open: this.open,
      setScratch: this.setScratch,
      close: this.close,
      discard: this.discard,
      undo: this.undo,
    };
  }

  issuesFor = (path: string): FormIssue[] =>
    issuesForPath(this.args.issues ?? [], path);

  isDirty = (path: string): boolean =>
    Object.prototype.hasOwnProperty.call(this.draft, path);

  /** What a field should SHOW: its pending edit if it has one, else the
   *  saved value the host handed it. */
  committed = (path: string, saved: unknown): unknown =>
    this.isDirty(path) ? this.draft[path] : saved;

  open = (path: string, saved: unknown) => {
    this.lastClosed = null;
    this.editingPath = path;
    this.scratch = this.committed(path, saved);
  };

  setScratch = (value: unknown) => {
    this.scratch = value;
  };

  /** Commit the in-flight value into the batch and close the editor. A
   *  second call for the same path is a no-op — which is what makes the
   *  Escape-then-focusout and Enter-then-focusout sequences safe, since
   *  removing a focused element can fire focusout on the way out. */
  close = (path: string, restoreFocus: boolean) => {
    if (this.editingPath !== path) {
      return;
    }
    let next = { ...this.draft };
    next[path] = this.scratch;
    this.draft = next;
    this.editingPath = null;
    this.scratch = undefined;
    this.lastClosed = restoreFocus ? path : null;
  };

  /** Throw the in-flight value away. The field's ALREADY-COMMITTED draft
   *  entry survives, and so does every other field's — that is the
   *  difference between cancelling an edit and cancelling the batch. */
  discard = (path: string, restoreFocus: boolean) => {
    if (this.editingPath !== path) {
      return;
    }
    this.editingPath = null;
    this.scratch = undefined;
    this.lastClosed = restoreFocus ? path : null;
  };

  undo = (path: string) => {
    let next = { ...this.draft };
    delete next[path];
    this.draft = next;
    if (this.editingPath === path) {
      this.editingPath = null;
      this.scratch = undefined;
    }
    this.lastClosed = path;
  };

  save = () => {
    let batch = { ...this.draft };
    this.editingPath = null;
    this.scratch = undefined;
    this.lastClosed = null;
    this.draft = {};
    this.args.onSave?.(batch);
  };

  /** Discards EVERYTHING: the open editor's keystrokes and every committed
   *  draft entry. If the pointer path commits the open field on its way to
   *  this button, the entry it just made is cleared right here — so the
   *  outcome is identical whichever way focus moved. */
  cancelAll = () => {
    this.editingPath = null;
    this.scratch = undefined;
    this.lastClosed = null;
    this.draft = {};
    this.args.onCancel?.();
  };

  get state(): RecordDetailState {
    return {
      dirtyCount: this.dirtyCount,
      dirtyPaths: this.dirtyPaths,
      editingPath: this.editingPath,
      save: this.save,
      cancel: this.cancelAll,
    };
  }

  <template>
    <div
      class='pretui-record'
      data-layout={{this.layout}}
      data-cols={{this.columns}}
      data-test-pretui-record-detail
      ...attributes
    >
      {{#if this.showSummary}}
        <div class='pretui-record-summary'>
          <Alert
            @tone={{this.summaryTone}}
            @title={{this.summaryTitle}}
            data-test-pretui-record-summary
          >
            <ul class='pretui-record-summarylist'>
              {{#each this.summaryIssues as |issue|}}
                <li data-severity={{severityOf issue}}>
                  <span
                    class='pretui-record-summarypath'
                  >{{issue.targetPath}}</span>
                  {{issue.message}}
                </li>
              {{/each}}
            </ul>
          </Alert>
        </div>
      {{/if}}

      <div class='pretui-record-grid' data-test-pretui-record-grid>
        {{yield
          (hash
            Field=(component RecordField api=this.api)
            Compound=(component CompoundField issues=@issues)
            state=this.state
          )
        }}
      </div>

      {{#unless @hideFooter}}
        <FormFooter
          @count={{this.dirtyCount}}
          @issues={{@issues}}
          @saving={{@saving}}
          @onSave={{this.save}}
          @onCancel={{this.cancelAll}}
        />
      {{/unless}}
    </div>

    <style scoped>
      /* above IconButton's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* The record is the container; the grid below it is what the queries
           match. An unnamed container query resolves against the nearest
           ANCESTOR container, so this pair has to be two elements.
           No overflow clipping: an in-place Select dropdown and the Tooltip
           must be able to leave the record's box. */
        .pretui-record {
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: var(--card);
          border-radius: var(--radius-surface, 10px);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
        }
        .pretui-record-summary {
          padding: var(--space-4, 11px) var(--space-5, 14px) 0;
        }
        .pretui-record-summarylist {
          margin: 0;
          padding-inline-start: 1.1em;
          display: grid;
          gap: 2px;
        }
        .pretui-record-summarylist li {
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 16px;
        }
        /* Law 3 — a BXL label path is a machine value, so it is set mono and
           reads as one inside the prose of the message. */
        .pretui-record-summarypath {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          margin-inline-end: 5px;
        }

        .pretui-record-grid {
          display: grid;
          column-gap: var(--space-6, 19px);
          row-gap: 0;
          align-items: start;
          padding: var(--space-4, 11px) var(--space-5, 14px);
          min-width: 0;
        }
        /* Column counts as attribute rules rather than
           `repeat(var(--n), …)`: the fold rules below need to WIN, and they
           can only do that at matching specificity in later source order. */
        .pretui-record[data-cols='1'] .pretui-record-grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .pretui-record[data-cols='2'] .pretui-record-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .pretui-record[data-cols='3'] .pretui-record-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .pretui-record[data-cols='4'] .pretui-record-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        /* Two real breakpoints where SLDS has one viewport media query. */
        @container (max-width: 52rem) {
          .pretui-record[data-cols='3'] .pretui-record-grid,
          .pretui-record[data-cols='4'] .pretui-record-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @container (max-width: 32rem) {
          .pretui-record[data-cols] .pretui-record-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>
}
