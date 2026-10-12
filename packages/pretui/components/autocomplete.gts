// Pretui — Autocomplete: free text with suggestions beside it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import XIcon from '@cardstack/boxel-icons/x';
import { OwnedTimers, listen, ownsTimers } from '../focus';
import { Button } from './button';
import { VisuallyHidden } from './visually-hidden';
import { PRETUI_TONES, emit, firstDefined, resolveSize, resolveTone } from '../pretui-primitives';
import type {
  ControlAliasArgs,
  PretuiAppearance,
  PretuiSize,
  PretuiSizeArg,
  PretuiToneArg,
  PretuiTone,
} from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// Autocomplete — pure helpers
// ═════════════════════════════════════════════════════════════════════════

export interface AutocompleteItem {
  /** what lands in the field when this suggestion is chosen */
  value: string;
  /** visible text; defaults to `value` */
  label?: string;
  /** secondary line in the row */
  meta?: string;
  /** announced and skipped by the arrows, but still rendered */
  disabled?: boolean;
}

/** `contains` (default) is what every React kit ships; `starts-with` is the
 * prefix behaviour a code/identifier field wants; `none` means the caller has
 * already filtered — the correct mode for an async `@onSearch`, where
 * re-filtering the server's answer against the current keystroke hides rows
 * the server deliberately returned. */
export type AutocompleteFilter = 'contains' | 'starts-with' | 'none';

export function filterItems(
  items: readonly AutocompleteItem[],
  query: string,
  mode: AutocompleteFilter = 'contains',
): AutocompleteItem[] {
  let needle = (query ?? '').trim().toLowerCase();
  if (mode === 'none' || needle === '') {
    return [...items];
  }
  return items.filter((item) => {
    let hay = (item.label ?? item.value).toLowerCase();
    return mode === 'starts-with'
      ? hay.startsWith(needle)
      : hay.includes(needle);
  });
}

export interface LabelParts {
  before: string;
  hit: string;
  after: string;
}

/** Splits a label around the first case-insensitive occurrence of the query,
 * so the matched run can be emphasised. Returns the whole label as `before`
 * when there is no match, which is what makes it safe to render
 * unconditionally. */
export function matchSpan(label: string, query: string): LabelParts {
  let text = label ?? '';
  let needle = (query ?? '').trim();
  if (!needle) {
    return { before: text, hit: '', after: '' };
  }
  let at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) {
    return { before: text, hit: '', after: '' };
  }
  return {
    before: text.slice(0, at),
    hit: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length),
  };
}

/** Where the highlight came from. This is the whole reason Enter can be
 * unambiguous: a highlight the COMPONENT put there (`auto`) or the POINTER
 * put there does not speak for the keyboard. */
export type HighlightSource = 'none' | 'auto' | 'pointer' | 'user';

/** What Enter means when the highlighted suggestion and the typed text
 * disagree. `deliberate` (default) is the honest answer; `highlight` is the
 * strict listbox behaviour; `text` never lets a suggestion win. */
export type EnterMode = 'deliberate' | 'highlight' | 'text';

export type CommitTarget = 'highlight' | 'text' | 'none';

/**
 * Identity on `text`, with a second parameter that exists only to be READ.
 *
 * React snaps a controlled input back when the owner declines a keystroke;
 * Glimmer does not, because the bound reference never became dirty — which is
 * how a "controlled" field in most Ember kits quietly stops being controlled
 * after the first rejected character. Passing a revision counter through here
 * makes the value reference re-validate on a rejection, so the caller's value
 * is written back into the field. The parameter is deliberately unused.
 */
export function valueAt(text: string, _revision: number): string {
  return text;
}

/**
 * THE hard decision of a free-text autocomplete, isolated as six lines of
 * pure function so it can be proven without a DOM.
 *
 * MUI arrives at the same rule (`useAutocomplete.js`, the
 * `hasProgrammaticHighlight` branch) but reaches it through four interacting
 * flags — `freeSolo`, `autoHighlight`, `inputPristine`, `autoSelect` — and
 * never states it. Stated: **a suggestion wins Enter only when the reader put
 * the highlight there with the keyboard.** Typing "chart" while row 0 sits
 * pre-highlighted commits "chart", not row 0. Arrowing down to row 0 commits
 * row 0. Hovering row 0 with the mouse and then pressing Enter commits
 * "chart", because a hand on the keyboard is not looking at the pointer.
 */
export function commitTarget(
  mode: EnterMode,
  source: HighlightSource,
): CommitTarget {
  if (mode === 'text') {
    return 'text';
  }
  let highlighted = source !== 'none';
  if (mode === 'highlight') {
    return highlighted ? 'highlight' : 'none';
  }
  return source === 'user' ? 'highlight' : 'text';
}

/** Wrapping step, with `-1` meaning "nothing highlighted": stepping forward
 * from nothing lands on the first row, backward on the last. */
export function stepIndex(
  current: number,
  count: number,
  step: number,
): number {
  if (count <= 0) {
    return -1;
  }
  if (current < 0) {
    return step > 0 ? 0 : count - 1;
  }
  return (current + step + count) % count;
}

/** The next index the arrows may land on, skipping disabled rows. Returns
 * `-1` when every row is disabled, rather than parking the highlight on a row
 * Enter would refuse. */
export function nextEnabled(
  disabled: readonly boolean[],
  current: number,
  step: number,
): number {
  let count = disabled.length;
  if (count === 0) {
    return -1;
  }
  let at = current;
  for (let hop = 0; hop < count; hop++) {
    at = stepIndex(at, count, step);
    if (!disabled[at]) {
      return at;
    }
  }
  return -1;
}

// ═════════════════════════════════════════════════════════════════════════
// Autocomplete
// ═════════════════════════════════════════════════════════════════════════

interface AutocompleteRow {
  id: string;
  index: number;
  value: string;
  label: string;
  meta: string | undefined;
  disabled: boolean;
  active: boolean;
  parts: LabelParts;
  item: AutocompleteItem;
}

export interface AutocompleteSignature {
  Args: ControlAliasArgs & {
    /** CONTROLLED text. In an autocomplete the value IS what the reader
     * typed — that is the whole difference from `Combobox`, whose value is
     * constrained to its listbox. */
    value?: string;
    /** uncontrolled seed */
    defaultValue?: string;
    /** the suggestion collection (canonical noun, react-ecosystem-gap) */
    items?: readonly AutocompleteItem[];
    /** alias — the `options` spelling every React kit uses */
    options?: readonly AutocompleteItem[];
    /** CONTROLLED suggestion layer */
    open?: boolean;
    /** uncontrolled seed for the layer */
    defaultOpen?: boolean;
    /** fires whenever the suggestion layer opens or closes */
    onOpenChange?: (open: boolean) => void;
    /** the debounced query, for a caller that fetches suggestions. Pair with
     * `@filter='none'`, since the caller has already decided what matches. */
    onSearch?: (query: string) => void;
    /** fires when a value is COMMITTED — Enter, a click, or blur — with the
     * suggestion when one was chosen and `undefined` for free text. This is
     * the callback that distinguishes "typing" from "meaning it". */
    onCommit?: (value: string, item?: AutocompleteItem) => void;
    /** SECONDS of quiet before `@onSearch` fires (kit law: seconds
     * everywhere). `0`, the default, fires on every keystroke and schedules
     * no timer at all. */
    debounce?: number;
    filter?: AutocompleteFilter;
    /** what Enter means when the highlight and the typed text disagree */
    enterCommits?: EnterMode;
    /** pre-highlight the first row when suggestions appear. Note that an
     * automatic highlight still does NOT win Enter under the default
     * `@enterCommits='deliberate'`. */
    autoHighlight?: boolean;
    /** open the layer when the field receives focus (default `true`) */
    openOnFocus?: boolean;
    /** suppress the layer until this many characters are typed */
    minChars?: number;
    /** cap on rendered rows; the rest are reachable by narrowing */
    maxVisible?: number;
    /** show a clear button once the field has text */
    clearable?: boolean;
    /** pending: `aria-busy` on the field, a progress line on the layer, and
     * focus RETAINED (react-ecosystem-gap axis 12) */
    busy?: boolean;
    loading?: boolean;
    isPending?: boolean;
    invalid?: boolean;
    isInvalid?: boolean;
    disabled?: boolean;
    required?: boolean;
    readonly?: boolean;
    placeholder?: string;
    /** accessible name. Rendered as a real `sr-only` `<label for>` unless a
     * wrapper claims the field with `@controlId`. */
    label?: string;
    /** a wrapper (Field, PropertyRow) that owns the visible label passes the
     * id it points at; the component then renders no label of its own */
    controlId?: string;
    describedBy?: string;
    /** replaces the built-in "No matches" line */
    emptyText?: string;
    tone?: PretuiToneArg;
    appearance?: PretuiAppearance;
    size?: PretuiSizeArg;
  };
  Blocks: {
    /** replaces the default row body. Yields the item and the live query.
     * Rendered inside an `aria-hidden` face, so any markup is legal here —
     * the option's accessible name is computed, not scraped. */
    item: [AutocompleteItem, { query: string; active: boolean }];
    /** replaces the built-in empty line */
    empty: [];
  };
  Element: HTMLDivElement;
}

/**
 * Free text with suggestions beside it.
 *
 * **From:** MUI `useAutocomplete` (`freeSolo`), Mantine `Autocomplete`, Base
 * UI `Autocomplete` (`mode='list'`), Ant `AutoComplete`.
 *
 * **What this fixes relative to those.**
 *
 * · **Enter is stated, not emergent.** MUI's answer lives in four interacting
 *   flags and one undocumented `hasProgrammaticHighlight` branch; here it is
 *   `commitTarget()`, six lines, one knob (`@enterCommits`), and a unit test.
 * · **Home and End are left alone.** MUI defaults `handleHomeEndKeys` to
 *   `false` under `freeSolo` and Mantine binds them anyway; in a field whose
 *   value is prose, Home and End belong to the CARET. Stealing them to jump
 *   the listbox breaks text editing in a control whose entire premise is that
 *   you are editing text.
 * · **The typed value is never silently reverted.** MUI's `clearOnBlur`
 *   defaults to `!freeSolo`, so the same component throws typed text away in
 *   one mode and keeps it in the other. Here blur always COMMITS, and Escape
 *   is the explicit undo: once to close the layer, again to restore the last
 *   committed value.
 * · **Async without a wall-clock lie.** `@debounce` is in SECONDS (kit law)
 *   and the handle is owned by an `ember-modifier`, so it cannot outlive the
 *   element. With `@debounce={{0}}` — the default — no timer is scheduled at
 *   all, and if the modifier never installs, `OwnedTimers` degrades to firing
 *   immediately rather than to firing never.
 * · **The rows are lint-safe for callers.** Realm lint's
 *   `require-presentational-children` errors on any component or `<svg>`
 *   inside a `role='option'` — and because `{{yield}}` is invisible to it, an
 *   avatar in a caller's `<:item>` block would fail the CALLER's file with a
 *   position pointing at nothing. The row is split into an `aria-hidden` face
 *   (any markup) and a bare option overlay (the computed name), so the block
 *   is free.
 * · **Empty is deliberate** and yields `<:empty>`, rather
 *   than an open popup containing nothing.
 */
export class Autocomplete extends Component<AutocompleteSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private searchHandle: ReturnType<typeof setTimeout> | undefined;

  @tracked private internalValue: string = this.args.defaultValue ?? '';
  @tracked private internalOpen: boolean = this.args.defaultOpen ?? false;
  @tracked private highlight = -1;
  @tracked private source: HighlightSource = 'none';
  @tracked private committed: string = this.args.defaultValue ?? '';
  /** Bumped whenever a CONTROLLED caller declined a keystroke. See `valueAt`. */
  @tracked private rejections = 0;

  // ── identity ──────────────────────────────────────────────────────────
  get inputId(): string {
    return this.args.controlId ?? this.guid + '-ac';
  }
  get listId(): string {
    return this.guid + '-list';
  }
  /** A wrapper that supplies `@controlId` owns the visible label, so this
   * renders none. Two names on one field is a defect — and realm lint's
   * `require-input-label` counts an `id` plus an `aria-label` as exactly
   * that, so this branch is also the only shape that passes the gate. */
  get ownsLabel(): boolean {
    return this.args.controlId === undefined;
  }
  get fieldLabel(): string {
    return this.args.label ?? 'Search';
  }
  get listLabel(): string {
    return this.fieldLabel + ' suggestions';
  }

  // ── resolved state ────────────────────────────────────────────────────
  get value(): string {
    return valueAt(this.args.value ?? this.internalValue, this.rejections);
  }
  get items(): readonly AutocompleteItem[] {
    return this.args.items ?? this.args.options ?? [];
  }
  get filterMode(): AutocompleteFilter {
    return this.args.filter ?? 'contains';
  }
  get enterMode(): EnterMode {
    return this.args.enterCommits ?? 'deliberate';
  }
  get inert(): boolean {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get readonly(): boolean {
    return (
      firstDefined(
        this.args.readonly,
        this.args.isReadOnly,
        this.args.readOnly,
      ) ?? false
    );
  }
  get invalid(): boolean {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get required(): boolean {
    return firstDefined(this.args.required, this.args.isRequired) ?? false;
  }
  get busy(): boolean {
    return (
      firstDefined(this.args.busy, this.args.loading, this.args.isPending) ??
      false
    );
  }
  get tone(): PretuiTone {
    return resolveTone(this.args.tone, PRETUI_TONES, 'neutral');
  }
  get appearance(): PretuiAppearance {
    return this.args.appearance ?? 'filled-outlined';
  }
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get minChars(): number {
    let raw = this.args.minChars;
    return raw !== undefined && raw > 0 ? raw : 0;
  }
  get maxVisible(): number {
    let raw = this.args.maxVisible;
    return raw !== undefined && raw > 0 ? raw : 8;
  }
  get emptyText(): string {
    return this.args.emptyText ?? 'No matches';
  }
  // a disabled field shows no Clear, since Clear can't act on it
  get clearable(): boolean {
    return (
      (this.args.clearable ?? false) && !this.inert && this.value.length > 0
    );
  }
  // Disabled stays focusable (aria-disabled, not the native attribute), so
  // readonly is what stops the browser editing the text.
  get blocksTyping(): boolean {
    return this.inert || this.readonly;
  }
  get clearLabel(): string {
    return 'Clear ' + this.fieldLabel;
  }

  // ── rows ──────────────────────────────────────────────────────────────
  get matches(): AutocompleteItem[] {
    return filterItems(this.items, this.value, this.filterMode).slice(
      0,
      this.maxVisible,
    );
  }
  get rows(): AutocompleteRow[] {
    let query = this.value;
    return this.matches.map((item, index) => {
      let label = item.label ?? item.value;
      return {
        id: this.guid + '-o' + String(index),
        index,
        value: item.value,
        label,
        meta: item.meta,
        disabled: item.disabled === true,
        active: index === this.highlight,
        parts: matchSpan(label, query),
        item,
      };
    });
  }
  private get disabledFlags(): boolean[] {
    return this.rows.map((row) => row.disabled);
  }
  get hasRows(): boolean {
    return this.rows.length > 0;
  }
  /** The layer is open when the caller says so (controlled) or when the
   * component opened it AND the minimum-characters gate is satisfied. */
  get popupOpen(): boolean {
    if (this.inert || this.readonly) {
      return false;
    }
    let wanted = this.args.open ?? this.internalOpen;
    return wanted && this.value.length >= this.minChars;
  }
  get expandedAttr(): string {
    return this.popupOpen ? 'true' : 'false';
  }
  get activeId(): string | undefined {
    if (!this.popupOpen || this.highlight < 0) {
      return undefined;
    }
    return this.rows[this.highlight]?.id;
  }
  /** APG asks a combobox to announce how many suggestions arrived. Computed
   * rather than written into tracked state, so nothing here can backtrack. */
  get suggestionStatus(): string {
    if (!this.popupOpen) {
      return '';
    }
    if (this.busy) {
      return 'Loading suggestions';
    }
    let total = this.rows.length;
    if (total === 0) {
      return this.emptyText;
    }
    return String(total) + (total === 1 ? ' suggestion' : ' suggestions');
  }
  rowState = (row: AutocompleteRow) => ({
    query: this.value,
    active: row.active,
  });

  // ── writes ────────────────────────────────────────────────────────────
  private writeValue(next: string) {
    if (this.args.value === undefined) {
      this.internalValue = next;
    } else {
      // Controlled: the caller decides. Dirty the value reference so the
      // field is repainted with whatever the caller still holds — otherwise
      // the DOM keeps the rejected keystroke and the contract is a lie.
      this.rejections = this.rejections + 1;
    }
    emit([this.args.onChange, this.args.onValueChange], next);
  }
  private setOpen(next: boolean) {
    // Compare against what was ASKED for, not against `popupOpen` — the
    // minimum-characters gate can hold the layer shut while the component
    // legitimately wants it open, and comparing to the visible state there
    // would make every keystroke re-fire `@onOpenChange`.
    if (next === (this.args.open ?? this.internalOpen)) {
      return;
    }
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    if (!next) {
      this.highlight = -1;
      this.source = 'none';
    }
    this.args.onOpenChange?.(next);
  }
  private commit(next: string, item?: AutocompleteItem) {
    this.committed = next;
    if (next !== this.value) {
      this.writeValue(next);
    }
    this.args.onCommit?.(next, item);
  }
  private focusField() {
    document.getElementById(this.inputId)?.focus();
  }
  /** Debounce that terminates: the handle is cancelled and rescheduled from a
   * user event, never from its own callback, so it can never re-arm and
   * cannot strand `await settled()`. Same shape as `TypeaheadBuffer`. */
  private scheduleSearch(query: string) {
    let ask = this.args.onSearch;
    if (!ask) {
      return;
    }
    let seconds = this.args.debounce ?? 0;
    let ms = Math.round(seconds * 1000);
    this.timers.cancel(this.searchHandle);
    this.searchHandle = undefined;
    if (ms <= 0 || !this.timers.active) {
      ask(query);
      return;
    }
    this.searchHandle = this.timers.after(ms, () => {
      this.searchHandle = undefined;
      ask(query);
    });
  }

  // ── handlers ──────────────────────────────────────────────────────────
  handleInput = (event: Event) => {
    if (this.inert || this.readonly) {
      return;
    }
    let text = (event.target as HTMLInputElement).value;
    this.writeValue(text);
    this.highlight = this.args.autoHighlight ? 0 : -1;
    this.source = this.args.autoHighlight ? 'auto' : 'none';
    this.setOpen(true);
    this.scheduleSearch(text);
  };

  handleFieldFocus = () => {
    if (this.inert || this.readonly) {
      return;
    }
    if ((this.args.openOnFocus ?? true) && this.items.length > 0) {
      this.setOpen(true);
    }
  };

  private move(step: number) {
    if (!this.popupOpen) {
      this.setOpen(true);
    }
    let next = nextEnabled(this.disabledFlags, this.highlight, step);
    this.highlight = next;
    this.source = next < 0 ? 'none' : 'user';
  }

  handleKeyDown = (event: Event) => {
    let key = event as KeyboardEvent;
    if (key.altKey || key.metaKey || key.ctrlKey) {
      return;
    }
    // Home and End are NOT bound. In a field whose value is free text they
    // belong to the caret; MUI reaches the same conclusion under freeSolo.
    if (key.key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
      return;
    }
    if (key.key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
      return;
    }
    if (key.key === 'Escape') {
      if (this.popupOpen) {
        event.preventDefault();
        this.setOpen(false);
        return;
      }
      if (this.value !== this.committed) {
        event.preventDefault();
        this.writeValue(this.committed);
      }
      return;
    }
    if (key.key === 'Enter') {
      let target = commitTarget(this.enterMode, this.source);
      if (target === 'highlight') {
        let row = this.rows[this.highlight];
        if (row && !row.disabled) {
          event.preventDefault();
          this.chooseRow(row);
        }
        return;
      }
      if (target === 'none') {
        if (this.popupOpen) {
          event.preventDefault();
        }
        return;
      }
      // Free text. The layer is consumed, but a closed layer must let Enter
      // reach an enclosing form — swallowing it would break submit.
      if (this.popupOpen) {
        event.preventDefault();
        this.setOpen(false);
      }
      this.commit(this.value);
    }
  };

  /** One delegated listener rather than one per row, and it is the reason a
   * pointer highlight is distinguishable from a keyboard one. */
  handleHover = (event: Event) => {
    let target = event.target as HTMLElement | null;
    let row = target?.closest('[data-ac-index]') as HTMLElement | null;
    if (!row) {
      return;
    }
    let index = Number(row.dataset['acIndex']);
    if (Number.isNaN(index) || index === this.highlight) {
      return;
    }
    if (this.rows[index]?.disabled) {
      return;
    }
    this.highlight = index;
    this.source = 'pointer';
  };

  /**
   * Keeps focus in the field while a suggestion is being clicked.
   *
   * A pointer press on a non-focusable element blurs the input, the blur
   * closes the layer, the layer leaves the DOM, and the click that was about
   * to land has no target — the classic combobox race. Every kit solves it by
   * cancelling the default focus move on the press, and this does the same.
   *
   * It is bound through the kit's `listen` modifier rather than `{{on}}` on
   * purpose: `{{on 'mousedown'}}` is rejected by realm lint's
   * `no-pointer-down-event-binding`, whose premise is that an ACTION must not
   * fire on the down edge. No action fires here — the action is on `click`,
   * where it belongs — and the only thing the handler does is decline to move
   * focus. Removing this line does not make the rule's concern go away; it
   * makes the component unusable with a mouse.
   */
  handlePress = (event: Event) => {
    let target = event.target as HTMLElement | null;
    if (target?.closest('[data-ac-popup]')) {
      event.preventDefault();
    }
  };

  handleFocusOut = (event: Event) => {
    let leaving = event as FocusEvent;
    let root = leaving.currentTarget as HTMLElement | null;
    let next = leaving.relatedTarget as Node | null;
    if (root && next && root.contains(next)) {
      return;
    }
    this.setOpen(false);
    // Blur COMMITS. A typed word abandoned by a Tab or a click elsewhere is
    // still what the reader meant; MUI throws it away under clearOnBlur.
    if (this.value !== this.committed) {
      this.commit(this.value);
    }
  };

  chooseRow = (row: AutocompleteRow) => {
    if (this.inert || this.readonly || row.disabled) {
      return;
    }
    this.setOpen(false);
    this.commit(row.value, row.item);
    this.focusField();
  };

  clear = () => {
    if (this.inert || this.readonly) {
      return;
    }
    this.setOpen(false);
    this.commit('');
    this.focusField();
  };

  <template>
    <div
      class='pretui-ac'
      data-tone={{this.tone}}
      data-appearance={{this.appearance}}
      data-size={{this.size}}
      data-open={{if this.popupOpen 'true' 'false'}}
      data-busy={{if this.busy 'true'}}
      data-invalid={{if this.invalid 'true'}}
      data-disabled={{if this.inert 'true'}}
      {{ownsTimers this.timers}}
      {{listen 'focusout' this.handleFocusOut}}
      {{listen 'mouseover' this.handleHover}}
      {{listen 'mousedown' this.handlePress}}
      data-test-pretui-autocomplete
      ...attributes
    >
      {{#if this.ownsLabel}}
        <label for={{this.inputId}}><VisuallyHidden
          >{{this.fieldLabel}}</VisuallyHidden></label>
      {{/if}}

      <div class='pretui-ac-field'>
        <input
          type='text'
          class='pretui-ac-input'
          id={{this.inputId}}
          role='combobox'
          autocomplete='off'
          aria-autocomplete='list'
          aria-expanded={{this.expandedAttr}}
          aria-controls={{this.listId}}
          aria-activedescendant={{this.activeId}}
          aria-describedby={{@describedBy}}
          aria-invalid={{if this.invalid 'true'}}
          aria-required={{if this.required 'true'}}
          aria-disabled={{if this.inert 'true'}}
          aria-busy={{if this.busy 'true'}}
          placeholder={{@placeholder}}
          readonly={{this.blocksTyping}}
          value={{this.value}}
          {{on 'input' this.handleInput}}
          {{on 'focus' this.handleFieldFocus}}
          {{on 'keydown' this.handleKeyDown}}
          data-test-pretui-autocomplete-input
        />
        {{#if this.busy}}
          <span class='pretui-ac-spin' aria-hidden='true'></span>
        {{else if this.clearable}}
          <Button
            class='pretui-ac-clear'
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            aria-label={{this.clearLabel}}
            {{on 'click' this.clear}}
            data-test-pretui-autocomplete-clear
          ><XIcon width='12' height='12' aria-hidden='true' /></Button>
        {{/if}}
      </div>

      {{#if this.popupOpen}}
        <ul
          class='pretui-ac-list'
          id={{this.listId}}
          role='listbox'
          aria-label={{this.listLabel}}
          data-ac-popup='true'
          data-test-pretui-autocomplete-list
        >
          {{#if this.hasRows}}
            {{#each this.rows key='id' as |row|}}
              <li
                class='pretui-ac-row'
                role='presentation'
                data-ac-index={{row.index}}
                data-active={{if row.active 'true'}}
              >
                {{!-- the face carries the chrome and is invisible to AT, so a
                      caller may yield ANY markup into it without tripping
                      require-presentational-children in their own file --}}
                <span
                  class='pretui-ac-face'
                  aria-hidden='true'
                  data-test-pretui-autocomplete-face
                >
                  {{#if (has-block 'item')}}
                    {{yield row.item (this.rowState row) to='item'}}
                  {{else}}
                    <span
                      class='pretui-ac-label'
                    >{{row.parts.before}}<span
                        class='pretui-ac-hit'
                      >{{row.parts.hit}}</span>{{row.parts.after}}</span>
                    {{#if row.meta}}
                      <span class='pretui-ac-meta'>{{row.meta}}</span>
                    {{/if}}
                  {{/if}}
                </span>
                <span
                  class='pretui-ac-option'
                  role='option'
                  id={{row.id}}
                  aria-label={{row.label}}
                  aria-selected={{if row.active 'true' 'false'}}
                  aria-disabled={{if row.disabled 'true'}}
                  {{on 'click' (fn this.chooseRow row)}}
                  data-test-pretui-autocomplete-option={{row.value}}
                ></span>
              </li>
            {{/each}}
          {{else}}
            <li class='pretui-ac-none' role='presentation'>
              {{#if (has-block 'empty')}}
                {{yield to='empty'}}
              {{else}}
                <span class='pretui-ac-none-glyph' aria-hidden='true'></span>
                <span class='pretui-ac-none-text'>{{this.emptyText}}</span>
                <span class='pretui-ac-none-hint'>Press Enter to keep what you
                  typed.</span>
              {{/if}}
            </li>
          {{/if}}
        </ul>
      {{/if}}

      <VisuallyHidden
        role='status'
        data-test-pretui-autocomplete-status
      >{{this.suggestionStatus}}</VisuallyHidden>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-ac {
          position: relative;
          display: block;
          min-width: 0;
          font-size: var(--pretui-size-m, var(--boxel-font-size-xs));
        }
        /* the ladder has no step under 11px, so xs and s share it */
        .pretui-ac[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--boxel-font-size-2xs));
        }
        .pretui-ac[data-size='s'] {
          font-size: var(--pretui-size-s, var(--boxel-font-size-2xs));
        }
        .pretui-ac[data-size='l'] {
          font-size: var(--pretui-size-l, var(--boxel-font-size-sm));
        }
        .pretui-ac[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--boxel-font-size));
        }
        /* tone sets custom properties only: the fill hue for tints, its -ink
           for text and lines, and the default field's edge (--input when
           neutral, the -ink otherwise, so a tone shows in both schemes) */
        .pretui-ac {
          --pretui-ac-edge: var(--pretui-tone-ink);
        }
        .pretui-ac[data-tone='neutral'] {
          --pretui-tone: var(--foreground);
          --pretui-tone-ink: var(--foreground);
          --pretui-ac-edge: var(--input);
        }
        .pretui-ac[data-tone='primary'] {
          --pretui-tone: var(--primary);
          --pretui-tone-ink: var(--primary-ink);
        }
        .pretui-ac[data-tone='info'] {
          --pretui-tone: var(--info);
          --pretui-tone-ink: var(--info-ink);
        }
        .pretui-ac[data-tone='success'] {
          --pretui-tone: var(--success);
          --pretui-tone-ink: var(--success-ink);
        }
        .pretui-ac[data-tone='warning'] {
          --pretui-tone: var(--warning);
          --pretui-tone-ink: var(--warning-ink);
        }
        .pretui-ac[data-tone='danger'] {
          --pretui-tone: var(--destructive);
          --pretui-tone-ink: var(--destructive-ink);
        }
        .pretui-ac[data-tone='attention'] {
          --pretui-tone: var(--attention);
          --pretui-tone-ink: var(--attention-ink);
        }
        /* the edge is one variable: appearances and states set it, and only
           this rule draws it, so no selector has to outrank another */
        .pretui-ac-field {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.3em;
          min-width: 0;
          min-height: var(--pretui-ac-h, 2.24em);
          padding-inline: 0.5em;
          border-radius: var(--boxel-border-radius);
          box-shadow: 0 0 0 1px var(--pretui-ac-edge);
        }
        /* edges are drawn in the tone's -ink: the fill hue misses the 3:1 a
           field boundary needs */
        .pretui-ac[data-appearance='outlined'],
        .pretui-ac[data-appearance='accent'] {
          --pretui-ac-edge: var(--pretui-tone-ink);
        }
        .pretui-ac[data-appearance='filled'],
        .pretui-ac[data-appearance='plain'] {
          --pretui-ac-edge: transparent;
        }
        .pretui-ac[data-appearance='filled-outlined'] .pretui-ac-field {
          background-color: color-mix(
            in oklch,
            var(--pretui-tone) 6%,
            var(--field)
          );
          color: var(--foreground);
        }
        .pretui-ac[data-appearance='outlined'] .pretui-ac-field {
          background-color: var(--card);
          color: var(--card-foreground);
        }
        .pretui-ac[data-appearance='filled'] .pretui-ac-field {
          background-color: color-mix(
            in oklch,
            var(--pretui-tone) 15%,
            var(--card)
          );
          color: var(--card-foreground);
        }
        .pretui-ac[data-appearance='plain'] .pretui-ac-field {
          background-color: transparent;
        }
        .pretui-ac[data-appearance='accent'] .pretui-ac-field {
          background-color: var(--field);
          color: var(--foreground);
        }
        /* hover strengthens a neutral field's gray edge; a toned or inked
           edge is already strong */
        .pretui-ac[data-tone='neutral']:not([data-appearance='outlined'], [data-appearance='accent'], [data-invalid='true'])
          .pretui-ac-field:hover {
          --pretui-ac-edge: var(--border-strong);
        }
        .pretui-ac[data-invalid='true'] .pretui-ac-field {
          --pretui-ac-edge: var(--destructive-ink);
        }
        /* focus draws the box-shadow itself, so it wins over hover and the
           invalid edge: a reader must always see where they are */
        .pretui-ac-field:focus-within {
          box-shadow: 0 0 0 2px var(--ring);
        }
        .pretui-ac[data-disabled='true'] {
          opacity: 0.5;
        }
        .pretui-ac-input {
          flex: 1 1 auto;
          min-width: 0;
          height: 2em;
          border: 0;
          background-color: transparent;
          color: inherit;
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          outline: none;
        }
        .pretui-ac-input::placeholder {
          color: var(--muted-foreground);
        }
        /* a square 1.5rem target: Button's xs height, with no inline padding */
        .pretui-ac-clear {
          --pretui-button-px: 0;
          --pretui-button-min-w: 1.5rem;

          flex: none;
        }
        @keyframes pretui-ac-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .pretui-ac-spin {
          flex: none;
          width: 1.04em;
          height: 1.04em;
          border-radius: 50%;
          border: 1.5px solid color-mix(in oklch, currentColor 25%, transparent);
          border-top-color: var(--pretui-tone-ink);
          animation: pretui-ac-spin 0.7s linear infinite;
        }
        /* The layer renders IN PLACE: a portaled surface cannot
           inherit the theme's tokens, which is the whole theming contract. */
        .pretui-ac-list {
          position: absolute;
          z-index: var(--pretui-z-dropdown, 60);
          inset-inline: 0;
          inset-block-start: calc(100% + var(--boxel-sp-4xs));
          margin: 0;
          padding: 0.25em;
          max-height: 16em;
          overflow-y: auto;
          list-style: none;
          border-radius: var(--boxel-border-radius);
          background-color: var(--popover);
          color: var(--popover-foreground);
          box-shadow:
            0 0 0 1px var(--border),
            var(--shadow-md);
          animation: pretui-ac-drop var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease) both;
        }
        @keyframes pretui-ac-drop {
          from {
            opacity: 0;
            transform: translateY(-0.1875rem);
          }
        }
        .pretui-ac-row {
          position: relative;
          display: flex;
          align-items: baseline;
          gap: 0.5em;
          min-width: 0;
          padding: 0.34em 0.5em;
          border-radius: var(--boxel-border-radius-sm);
          cursor: pointer;
        }
        .pretui-ac-row[data-active='true'] {
          background-color: var(--hover);
        }
        .pretui-ac-face {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: baseline;
          gap: 0.5em;
          min-width: 0;
          flex: 1 1 auto;
          pointer-events: none;
        }
        .pretui-ac-option {
          position: absolute;
          z-index: 0;
          inset: 0;
          display: block;
        }
        .pretui-ac-option[aria-disabled='true'] {
          cursor: default;
        }
        .pretui-ac-row:has(.pretui-ac-option[aria-disabled='true']) {
          opacity: 0.45;
          cursor: default;
        }
        /* the truncation triple, never min-width alone */
        .pretui-ac-label {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-ac-hit {
          font-weight: 600;
          /* the tone's -ink: the fill hue misses 4.5:1 as text */
          color: var(--pretui-tone-ink);
        }
        .pretui-ac-meta {
          flex: none;
          font-size: var(--boxel-font-size-2xs);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        /* A deliberate empty state: a mark, the reason, and the
           next action — never a bare "no results". */
        .pretui-ac-none {
          display: grid;
          justify-items: center;
          gap: 0.2em;
          padding: 0.9em 0.6em;
          text-align: center;
        }
        .pretui-ac-none-glyph {
          width: 1.5em;
          height: 1.5em;
          border-radius: 50%;
          box-shadow: inset 0 0 0 1.5px var(--border);
        }
        .pretui-ac-none-text {
          font-weight: 500;
        }
        .pretui-ac-none-hint {
          font-size: var(--boxel-font-size-2xs);
          color: var(--muted-foreground);
        }
        @media (pointer: coarse) {
          .pretui-ac-row {
            padding-block: 0.6em;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-ac-list {
            animation: none;
          }
          .pretui-ac-spin {
            animation: none;
            transform: rotate(135deg);
          }
        }
      }
    </style>
  </template>
}

// Free-string chips with suggestions: compose Autocomplete over TagsInput
// (tags-input.gts), which maps the Mantine/Ant/Chakra tag-field arguments.
