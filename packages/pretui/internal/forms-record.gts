// Pretui — forms/record territory: the Salesforce record page.
//
// Ported from Salesforce Lightning Design System (local checkout
// `ui/components/form-element/{base,record-detail,compound,address}` and
// `ui/components/docked-form-footer/base`). SLDS's vocabulary maps as:
//
//   slds-form / slds-form__row / slds-form__item   → RecordDetail (+ @span)
//   slds-form-element_edit / __static / __undo     → RecordDetail's Field
//   slds-is-editing / slds-is-edited               → the batch state machine
//   slds-form-element_compound / __row / __legend  → CompoundField / .Row
//   slds-docked-form-footer                        → FormFooter
//
// WHY THIS SHAPE. Boxel cards autosave and have no submit, so a classic
// submit-form is the wrong fit. The SLDS record page is the honest one: a
// field renders as static text, a click (or Enter) reveals the editor IN
// PLACE, an undo reverts that one field, and a docked footer saves the
// accumulated batch. Everything here is plain values + label paths — no
// FieldDef, no <Cell>. The boxel-widgets adapter is a later layer on top.
//
// WHAT WE MADE BETTER THAN THE INSPIRATION is named per component in the doc
// comment above each class. The headline four:
//
//   1. SLDS's static value is a non-interactive <div>; the ONLY way into the
//      editor is a separate pencil ButtonIcon, and clicking the value itself
//      does nothing. Ours makes the static value the button — click
//      anywhere, Enter/Space activates, ONE tab stop per field, and the
//      button's accessible name carries the label AND the current value.
//   2. SLDS has no cancel path at all: no Escape handling, no pointer
//      discard. Ours gives Escape (returning focus to the trigger) and a
//      discard control, and neither touches any other field's edit.
//   3. SLDS fakes container queries with a VIEWPORT media query and says so
//      in its own source ("we'll use flexbox to mimic container query",
//      `@media (max-width: 304px)`). In a Boxel card a viewport query
//      measures the browser window, not the pane. Ours are real unnamed
//      container queries.
//   4. SLDS's docked footer is `position: fixed` — it escapes any card's
//      bounding box (and is lint-flagged in this codebase). Ours is
//      `position: sticky`, and it counts the unsaved changes out loud.
//
// VALIDATION IS NOT OUR JOB. Nothing here evaluates anything. Components
// accept already-computed `FormIssue[]` (produced by BXL guide rules) and
// render them. `targetPath` is matched as a WHOLE STRING — predicate paths
// like `"Line Item"[SKU = "COPY-04"].Quantity` contain dots, brackets,
// quotes and spaces, so splitting on '.' is a correctness bug. Unknown
// severities are treated as blocking (fail closed, matching the guide
// contract).
//
// Realm laws in force: no timers of any kind (the editor's focus handoff is
// a modifier, not a setTimeout); unnamed container queries only, and every
// one of them is authored so the rule matches a DESCENDANT of the element
// carrying `container-type` — an unnamed query resolves against the nearest
// ANCESTOR container, so a rule inside it can never match the container
// itself; no dark branches (every value is `var(--token, lightFallback)`);
// no !important / :deep() / :global().
//
// Pretui — issue routing and the batch contract shared by RecordDetail, its Field and CompoundField.
import { htmlSafe } from '@ember/template';
import { isBlocking, normalizeSeverity } from './forms-core';
import type { FormIssue } from './forms-core';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a curried
   contextual component's only precise type is glint's ComponentLike, which
   lives in '@glint/template'; that package is not resolvable in the realm
   type env, so there is no nameable type for these yields. */
export type ContextualComponent = any;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- same gap
   from the other side: this is an ember-modifier value, and 'ember-modifier'
   has no type declarations in the realm type env. */
type FocusModifier = any;

// ── Issue routing (never validation) ─────────────────────────────────────
//
// `isBlocking` / `normalizeSeverity` / `sortIssues` / `issuesForPath` are
// imported from forms-core, which owns them. The only rules restated here
// are the two template-callable shims below.

/** Display severity for a `data-severity` hook: 'error' | 'warning' | 'info',
 *  with anything unrecognised resolving to 'error'. Template-callable. */
export function severityOf(issue: FormIssue): string {
  return normalizeSeverity(issue.severity);
}

export function blockingCount(issues: FormIssue[] | undefined): number {
  return issues ? issues.filter(isBlocking).length : 0;
}

/** The static rendering of a plain value. Deliberately small: anything
 *  richer (an avatar, a link, a Chip, a currency format) is the `<:display>`
 *  block's job, not an arg. Law 7 — a slot, not a string. */
export function displayText(value: unknown, placeholder: string): string {
  if (value === null || value === undefined || value === '') {
    return placeholder;
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : placeholder;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A field only grows the click-to-edit trigger when it is editable AND the
 *  caller actually supplied an `<:editor>` block. `has-block` is a template
 *  construct, so the conjunction is written here rather than as a getter. */
export function showTrigger(editable: boolean, hasEditor: boolean): boolean {
  return editable && hasEditor;
}

// Guard for a caller-supplied CSS track list before it reaches a style
// attribute. Same posture as the kit guard in pretui-css.gts.
const TRACKS_RE = /^[\w.%\-+*/()[\], ]+$/;

export function tracksStyle(columns: string | undefined) {
  if (!columns || !TRACKS_RE.test(columns)) {
    return undefined;
  }
  return htmlSafe(`--pretui-compound-tracks: ${columns}`);
}
// ── The batch contract shared by RecordDetail and its Field ──────────────

export type RecordLayout = 'stacked' | 'horizontal';

/** The slice of RecordDetail's state machine a field needs. Supplied by
 *  RecordDetail through the yielded contextual component; never assembled
 *  by a caller. */
export interface RecordBatchApi {
  readOnly: boolean;
  layout: RecordLayout;
  placeholder: string;
  editingPath: string | null;
  lastClosed: string | null;
  scratch: unknown;
  issuesFor(path: string): FormIssue[];
  isDirty(path: string): boolean;
  committed(path: string, saved: unknown): unknown;
  open(path: string, saved: unknown): void;
  setScratch(value: unknown): void;
  close(path: string, restoreFocus: boolean): void;
  discard(path: string, restoreFocus: boolean): void;
  undo(path: string): void;
}

/** What the `<:editor>` block receives. The control itself is ALWAYS the
 *  caller's — this territory hardcodes no input. */
export interface RecordEditContext {
  /** The in-flight value: the committed draft when there is one, otherwise
   *  the saved value. Feed it straight to the control. */
  value: unknown;
  /** Put on the control so the field's <label for> points at it. */
  controlId: string;
  /** Report a new in-flight value. Nothing is committed until the editor
   *  closes, so a keystroke here never touches the batch. */
  set: (value: unknown) => void;
  /** Commit the in-flight value into the batch and close the editor. */
  commit: () => void;
  /** Throw the in-flight value away and close the editor. Any edit this
   *  field had ALREADY committed to the batch survives, as does every other
   *  field's. */
  cancel: () => void;
  /** True while this field carries a blocking issue — dress the control. */
  invalid: boolean;
  /** Focus modifier for the control that should take focus when the editor
   *  opens: `{{E.focus true}}`. The positional is explicit because the kit's
   *  shared `focusWhen` primitive is reused verbatim rather than re-cut into
   *  a zero-arg variant. */
  focus: FocusModifier;
}
