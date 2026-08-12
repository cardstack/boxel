import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import Modifier from 'ember-modifier';

// openkit/controls — layer 03, Reusable Semantic Building Blocks.
//
// <Select>, pass 2.
//
// WHY THIS COMPONENT FIRST. It is the one the whole versioning argument is
// about — a dropdown sits under every card in every realm, so it is the
// concrete case for "one release must not reindex the universe"
// (`docs/atlas-slice-version-scenarios.md` §7). It is also the component with
// the largest gap between "looks easy" and "is correct".
//
// UNBOUND FROM THE LEGACY, LITERALLY. `@cardstack/boxel-ui`'s select extends
// `PowerSelectArgs` — it is `ember-power-select` with a trigger and a theme
// observer bolted on, so its API surface is somebody else's and its behaviour
// is a build-time dependency of the host. This is the first select this stack
// actually owns: no addon underneath, no inherited argument names, and
// nothing here that a consumer cannot pin to a version.
//
// THE ARIA PATTERN. Focus never leaves the control's one focusable element —
// the trigger, or (pass 2) the search input when there is one. The current
// option is named by `aria-activedescendant` rather than by moving DOM focus
// into the list. That is the APG combobox pattern, and it is the one that
// survives contact with reality: moving real focus into a popup fights the
// browser over Tab order, breaks on iOS, and loses the caret.
//
// ─── PASS 2 (0.2.0): search and groups ──────────────────────────────────────
//
// Pass 1 named five gaps. This pass closes the two that stop the component
// working AT SCALE, which is where a select actually fails — nobody arrow-keys
// through two hundred currencies.
//
// SEARCH is opt-in via `@searchable`, so every existing caller renders exactly
// as it did. That is what makes this a MINOR rather than a major. Three things
// separate a good filter from a present one:
//
//   1. DIACRITIC-INSENSITIVE. Typing `mexico` finds `México`. A filter that
//      demands the accent only works for people who already know how to spell
//      the thing they are looking for.
//   2. RANKED, NOT MERELY FILTERED. A prefix hit outranks a mid-word hit, so
//      `us` puts `USD` above `Belarusian ruble`. Filtering without ranking is
//      why so many pickers make you type the whole word.
//   3. THE MATCH IS SHOWN. The matched run is marked inside the label, so a
//      reader can see WHY a row survived. Once rows are ranked this matters
//      more, not less: an unexplained ordering reads as randomness.
//
// GROUPS are opt-in via `group` on an option. A header is not selectable and
// not an option — it is `role='presentation'` inside a `role='group'`, and the
// flat index the keyboard walks skips it entirely. That is precisely why
// `rows` (flat, indexed, what the keyboard sees) is computed separately from
// `sections` (nested, what the template renders).
//
// FOCUS MOVES WHEN SEARCH IS ON, because you cannot type into something that
// does not have focus. With a search field the INPUT is the combobox and the
// trigger is a plain disclosure button; without one, pass 1's arrangement
// stands unchanged. Two patterns, one keyboard handler, chosen by whether
// there is a caret to own.
//
// STILL NOT DONE, said plainly rather than discovered later: multiple
// selection; a portal (a short scroll container still clips the listbox); and
// the highlight snaps rather than travels.
//
// SELF-CONTAINED. Base realm and the ambient framework only. No vendored
// engine, deliberately: the foundation has to be reachable without a runtime,
// and a select that needed WebGL to render would be an argument against the
// whole layering.

export interface SelectOption {
  /** Stable identity. Falls back to the label when absent. */
  key?: string;
  label: string;
  /** Secondary line, rendered smaller under the label. */
  description?: string;
  disabled?: boolean;
  /** New in 0.2.0. Options sharing a group are rendered under one header, in
   *  first-appearance order. Ungrouped options come first, headerless. */
  group?: string;
  /** Anything the caller wants back in `onChange`. */
  value?: unknown;
}

interface SelectSignature {
  Args: {
    options: SelectOption[];
    selected?: SelectOption | undefined;
    onChange: (option: SelectOption) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Shows the pending treatment instead of the list. */
    loading?: boolean;
    /** What to say when there are no options AT ALL — distinct from "your
     *  search matched nothing", which is `@noMatchesMessage`. A user can act
     *  on the difference, so the component must not collapse them. */
    emptyMessage?: string;
    label?: string;
    /** Ties the trigger to an external <label>. */
    labelledBy?: string;
    describedBy?: string;

    // ── new in 0.2.0 ──
    /** Opt in to the search field. Off by default, which is what keeps this
     *  release compatible. */
    searchable?: boolean;
    searchPlaceholder?: string;
    noMatchesMessage?: string;
    /** Override the built-in matcher — return a score (lower ranks higher) or
     *  `undefined` to exclude. Escape hatch for callers who want to search a
     *  field this component cannot see, e.g. an ISO code held in `value`. */
    matcher?: (option: SelectOption, term: string) => number | undefined;
  };
  Blocks: {
    /** Custom option rendering. Without it, label and description are used. */
    option: [SelectOption];
    /** Custom trigger content for the selected value. */
    trigger: [SelectOption | undefined];
  };
  Element: HTMLDivElement;
}

// Close when a click lands anywhere outside. A modifier rather than a global
// listener the component forgets to remove: teardown is the framework's job
// and this is the version of it that cannot leak.
class OnClickOutside extends Modifier<{
  Args: { Positional: [() => void] };
}> {
  private handler?: (event: MouseEvent) => void;
  private node?: Element;

  modify(element: Element, [callback]: [() => void]) {
    this.node = element;
    if (!this.handler) {
      this.handler = (event: MouseEvent) => {
        let target = event.target as Node | null;
        if (target && this.node && !this.node.contains(target)) {
          callback();
        }
      };
      // Capture phase, so a handler inside some other widget that stops
      // propagation cannot leave this listbox stuck open.
      document.addEventListener('mousedown', this.handler, true);
      registerDestructor(this, () => {
        if (this.handler) {
          document.removeEventListener('mousedown', this.handler, true);
        }
      });
    }
  }
}

// Keep the active option in view when the keyboard moves it. Scrolling the
// minimum distance rather than centring, because centring makes every arrow
// press move the whole list and the reader loses their place.
class ScrollIntoView extends Modifier<{
  Args: { Positional: [boolean] };
}> {
  modify(element: Element, [isActive]: [boolean]) {
    if (isActive) {
      element.scrollIntoView({ block: 'nearest' });
    }
  }
}

// New in 0.2.0. Move the caret into the search field as it appears. Without
// this the field is visible and inert, which is worse than not having one.
class AutoFocus extends Modifier<{ Args: { Positional: [] } }> {
  private done = false;
  modify(element: Element) {
    if (!this.done) {
      this.done = true;
      (element as HTMLInputElement).focus();
    }
  }
}

// How long a typeahead buffer survives. 500ms is the platform convention —
// long enough to type "gre" for Greece, short enough that a later unrelated
// "g" starts a fresh search rather than extending a stale one.
const TYPEAHEAD_WINDOW = 500;

// Rank bands. Separate constants rather than magic numbers in a comparator,
// because the ORDER of these bands is the search's entire user-visible
// personality and it should be legible in one place.
const RANK_PREFIX = 0; // "us" → "USD"
const RANK_WORD = 1; // "ru" → "Belarusian ruble" (a word starts with it)
const RANK_SUBSTRING = 2; // "rub" → "Kruberia" (anywhere at all)

export default class Select extends Component<SelectSignature> {
  @tracked isOpen = false;
  // The option the KEYBOARD is on, which is not the selected one. Conflating
  // the two is the classic listbox bug: arrowing through a list would commit
  // a value the user was only looking at.
  @tracked activeIndex = -1;
  // New in 0.2.0. Held here rather than read off the input, so the filter is
  // derived state and one render can never disagree with another.
  @tracked query = '';

  private typeahead = '';
  private typeaheadAt = 0;
  private id = `ok-select-${Math.random().toString(36).slice(2, 9)}`;

  get listboxId() {
    return `${this.id}-listbox`;
  }

  get allOptions(): SelectOption[] {
    return this.args.options ?? [];
  }

  get isSearchable() {
    return this.args.searchable === true;
  }

  get isDisabled() {
    return this.args.disabled === true;
  }

  /** Nothing to choose from in the first place. */
  get isEmpty() {
    return this.allOptions.length === 0;
  }

  /** There were options, and the query removed all of them. A different
   *  problem with a different remedy, so it gets a different message. */
  get isNoMatch() {
    return !this.isEmpty && this.visible.length === 0;
  }

  // The filtered, ranked list. EVERYTHING keyboard-related indexes into this
  // and not into `@options`, which is the one invariant that keeps search and
  // arrow keys from disagreeing about what row 3 is.
  get visible(): SelectOption[] {
    let term = this.query.trim();
    if (!term) {
      return this.allOptions;
    }
    let needle = fold(term);
    let scored: { option: SelectOption; rank: number; at: number }[] = [];
    for (let [at, option] of this.allOptions.entries()) {
      let rank = this.args.matcher
        ? this.args.matcher(option, term)
        : rankOption(option, needle);
      if (rank !== undefined) {
        scored.push({ option, rank, at });
      }
    }
    // Sort by (group, rank, author order). Group first, because reordering
    // across headers when a query is typed would scramble the very structure
    // the groups were added to provide. Author order last, so equally-good
    // matches keep the sequence the caller chose rather than an arbitrary one.
    let groupOrder = this.groupOrder;
    scored.sort(
      (a, b) =>
        (groupOrder.get(a.option.group ?? '') ?? 0) -
          (groupOrder.get(b.option.group ?? '') ?? 0) ||
        a.rank - b.rank ||
        a.at - b.at,
    );
    return scored.map((s) => s.option);
  }

  // First-appearance order of the groups, so headers stay where the caller put
  // them instead of sorting alphabetically behind their back.
  private get groupOrder(): Map<string, number> {
    let order = new Map<string, number>();
    // Ungrouped options sort ahead of every header, so a short list of common
    // choices can sit at the top without inventing a "General" heading.
    order.set('', -1);
    for (let option of this.allOptions) {
      let group = option.group ?? '';
      if (!order.has(group)) {
        order.set(group, order.size);
      }
    }
    return order;
  }

  // Flat and indexed: exactly what the keyboard walks and what
  // `aria-activedescendant` points at.
  get rows() {
    let selectedKey = keyOf(this.args.selected);
    let needle = fold(this.query.trim());
    return this.visible.map((option, index) => ({
      option,
      index,
      id: `${this.id}-option-${index}`,
      isSelected: selectedKey !== undefined && keyOf(option) === selectedKey,
      isActive: index === this.activeIndex,
      // Precomputed here rather than in the template: one pass over the list
      // instead of one comparison per option per render, and the template
      // stays free of helpers this pack deliberately does not import.
      parts: splitMatch(option.label, needle),
    }));
  }

  // Nested: what the template renders. Built FROM `rows`, so every row keeps
  // the flat index it already has and a header can never shift it.
  get sections() {
    let out: { key: string; heading: string | undefined; rows: unknown[] }[] =
      [];
    let current: (typeof out)[number] | undefined;
    for (let row of this.rows) {
      let group = row.option.group ?? '';
      if (!current || current.key !== group) {
        current = { key: group, heading: group || undefined, rows: [] };
        out.push(current);
      }
      current.rows.push(row);
    }
    return out;
  }

  get activeDescendantId() {
    return this.isOpen && this.activeIndex >= 0
      ? `${this.id}-option-${this.activeIndex}`
      : undefined;
  }

  get triggerLabel() {
    return this.args.selected?.label ?? this.args.placeholder ?? 'Select…';
  }

  get hasSelection() {
    return this.args.selected !== undefined;
  }

  @action open() {
    if (this.isDisabled || this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.query = '';
    // Opening lands on the current selection, so Enter is a no-op rather than
    // a surprise. With nothing selected it lands on the first option a user
    // could actually choose.
    let selectedKey = keyOf(this.args.selected);
    let at = this.visible.findIndex((o) => keyOf(o) === selectedKey);
    this.activeIndex = at >= 0 ? at : this.nextSelectable(-1, 1);
  }

  @action close() {
    this.isOpen = false;
    this.activeIndex = -1;
    this.query = '';
  }

  @action toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  @action choose(option: SelectOption) {
    if (option.disabled) {
      return;
    }
    this.args.onChange?.(option);
    this.close();
  }

  @action onSearch(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
    // Re-aim at the best remaining row. Leaving the index where it was would
    // point `aria-activedescendant` at a row that no longer exists, which a
    // screen reader announces as nothing at all.
    this.activeIndex = this.nextSelectable(-1, 1);
  }

  // Skips disabled options and wraps. Wrapping is right for a listbox: the
  // list is a ring, and stopping dead at the end is a small unexplained
  // failure every time a user holds the key down.
  private nextSelectable(from: number, step: number): number {
    let list = this.visible;
    let count = list.length;
    if (count === 0) {
      return -1;
    }
    for (let hop = 1; hop <= count; hop++) {
      let index = (((from + step * hop) % count) + count) % count;
      if (!list[index]?.disabled) {
        return index;
      }
    }
    // Every option disabled: nothing is selectable, and pretending otherwise
    // would put the highlight on something Enter cannot choose.
    return -1;
  }

  @action onKeydown(event: KeyboardEvent) {
    if (this.isDisabled) {
      return;
    }
    let { key } = event;
    let searching = this.isSearchable && this.isOpen;

    if (!this.isOpen) {
      if (
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'Enter' ||
        key === ' '
      ) {
        event.preventDefault();
        this.open();
        return;
      }
      // Typeahead works CLOSED as well as open, which is how a native select
      // behaves and how anyone filling a long form actually uses one. When the
      // component is searchable, a printable key opens it and lands in the
      // search field instead — one keystroke, not two.
      if (isTypeaheadKey(event)) {
        if (this.isSearchable) {
          this.open();
          this.query = key;
          this.activeIndex = this.nextSelectable(-1, 1);
          event.preventDefault();
          return;
        }
        event.preventDefault();
        let match = this.matchTypeahead(key);
        if (match) {
          this.args.onChange?.(match);
        }
      }
      return;
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex = this.nextSelectable(this.activeIndex, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex = this.nextSelectable(this.activeIndex, -1);
        break;
      case 'Home':
        // While searching, Home and End belong to the CARET. Stealing them for
        // the list is the bug that makes a search field feel broken.
        if (searching) {
          return;
        }
        event.preventDefault();
        this.activeIndex = this.nextSelectable(-1, 1);
        break;
      case 'End':
        if (searching) {
          return;
        }
        event.preventDefault();
        this.activeIndex = this.nextSelectable(this.visible.length, -1);
        break;
      case ' ':
        // A space is a character when there is a field to type it into.
        if (searching) {
          return;
        }
      // falls through — with no search field, space commits like Enter.
      case 'Enter': {
        event.preventDefault();
        let row = this.visible[this.activeIndex];
        if (row) {
          this.choose(row);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        // First Escape clears a query, second closes the popup. Anything else
        // throws away typing the user may only have wanted to correct.
        if (searching && this.query) {
          this.query = '';
          this.activeIndex = this.nextSelectable(-1, 1);
        } else {
          this.close();
        }
        break;
      case 'Tab':
        // Closes but does NOT commit. Tab means "I am moving on", and
        // committing whatever the highlight happened to be sitting on is a
        // value the user never chose.
        this.close();
        break;
      default:
        // With a search field the keystrokes are text, and `onSearch` has it.
        if (!searching && isTypeaheadKey(event)) {
          event.preventDefault();
          let match = this.matchTypeahead(key);
          if (match) {
            this.activeIndex = this.visible.indexOf(match);
          }
        }
    }
  }

  // Repeating the same letter cycles through the options starting with it,
  // which is what every native listbox does; anything else accumulates into a
  // prefix. Both behaviours come from one buffer, which is why they are here
  // together rather than as two features.
  private matchTypeahead(key: string): SelectOption | undefined {
    let now = Date.now();
    let expired = now - this.typeaheadAt > TYPEAHEAD_WINDOW;
    this.typeaheadAt = now;
    this.typeahead = expired ? key : this.typeahead + key;

    let sameLetter =
      this.typeahead.length > 1 &&
      [...this.typeahead].every((c) => c === this.typeahead[0]);
    let prefix = fold(sameLetter ? this.typeahead[0]! : this.typeahead);

    // Start the search AFTER the current position so a repeat advances
    // instead of landing on the same option forever.
    let list = this.visible;
    let count = list.length;
    let from = sameLetter ? this.activeIndex : this.activeIndex - 1;
    for (let hop = 1; hop <= count; hop++) {
      let index = (((from + hop) % count) + count) % count;
      let option = list[index];
      if (option && !option.disabled && fold(option.label).startsWith(prefix)) {
        return option;
      }
    }
    return undefined;
  }

  <template>
    <div class='ok-select' {{OnClickOutside this.close}} ...attributes>
      <button
        type='button'
        class='trigger {{unless this.hasSelection "is-placeholder"}}'
        role={{if this.isSearchable 'button' 'combobox'}}
        aria-expanded={{if this.isOpen 'true' 'false'}}
        aria-haspopup='listbox'
        aria-controls={{this.listboxId}}
        aria-activedescendant={{unless
          this.isSearchable
          this.activeDescendantId
        }}
        aria-label={{@label}}
        aria-labelledby={{@labelledBy}}
        aria-describedby={{@describedBy}}
        disabled={{this.isDisabled}}
        {{on 'click' this.toggle}}
        {{on 'keydown' this.onKeydown}}
      >
        <span class='trigger-text'>
          {{#if (has-block 'trigger')}}
            {{yield @selected to='trigger'}}
          {{else}}
            {{this.triggerLabel}}
          {{/if}}
        </span>
        <svg
          class='caret'
          viewBox='0 0 12 12'
          aria-hidden='true'
          focusable='false'
        >
          <path
            d='M2.5 4.5 6 8l3.5-3.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
            stroke-linejoin='round'
          />
        </svg>
      </button>

      {{#if this.isOpen}}
        <div class='popup'>
          {{#if this.isSearchable}}
            {{! With a field present, THIS is the combobox: it owns the caret,
                the activedescendant and the keyboard. The trigger above steps
                down to a plain disclosure button. }}
            <div class='search'>
              <svg
                class='search-icon'
                viewBox='0 0 12 12'
                aria-hidden='true'
                focusable='false'
              >
                <circle
                  cx='5'
                  cy='5'
                  r='3.25'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.4'
                />
                <path
                  d='M7.5 7.5 10.5 10.5'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.4'
                  stroke-linecap='round'
                />
              </svg>
              <input
                class='search-input'
                type='text'
                role='combobox'
                autocomplete='off'
                spellcheck='false'
                aria-expanded='true'
                aria-controls={{this.listboxId}}
                aria-activedescendant={{this.activeDescendantId}}
                aria-label={{if @label @label 'Filter options'}}
                placeholder={{if
                  @searchPlaceholder
                  @searchPlaceholder
                  'Type to filter…'
                }}
                value={{this.query}}
                {{AutoFocus}}
                {{on 'input' this.onSearch}}
                {{on 'keydown' this.onKeydown}}
              />
            </div>
          {{/if}}

          {{#if @loading}}
            <p class='state' role='status'>
              <span class='shimmer'></span>
              Loading…
            </p>
          {{else if this.isEmpty}}
            <p class='state' role='status'>{{if
                @emptyMessage
                @emptyMessage
                'Nothing to choose from'
              }}</p>
          {{else if this.isNoMatch}}
            {{! An empty list and a failed search are different problems with
                different remedies, so they never share a message. }}
            <p class='state' role='status'>{{if
                @noMatchesMessage
                @noMatchesMessage
                'No matches'
              }}</p>
          {{else}}
            <ul
              class='listbox'
              id={{this.listboxId}}
              role='listbox'
              aria-label={{@label}}
            >
              {{#each this.sections key='key' as |section|}}
                <li class='section' role='group' aria-label={{section.heading}}>
                  {{#if section.heading}}
                    {{! Presentation, not an option: the group is already named
                        for a screen reader by aria-label above, and a second
                        announcement of the same string is noise. }}
                    <p
                      class='section-heading'
                      role='presentation'
                    >{{section.heading}}</p>
                  {{/if}}
                  <ul class='section-list' role='presentation'>
                    {{#each section.rows key='id' as |row|}}
                      <li
                        class='option
                          {{if row.isActive "is-active"}}
                          {{if row.isSelected "is-selected"}}
                          {{if row.option.disabled "is-disabled"}}'
                        id={{row.id}}
                        role='option'
                        aria-selected={{if row.isSelected 'true' 'false'}}
                        aria-disabled={{if row.option.disabled 'true' 'false'}}
                        {{ScrollIntoView row.isActive}}
                        {{on 'click' (fn this.choose row.option)}}
                      >
                        {{#if (has-block 'option')}}
                          {{yield row.option to='option'}}
                        {{else}}
                          <span class='option-label'>
                            {{! Three spans, not a regex in the template: the
                                marked run shows WHY this row survived the
                                filter, which is what makes a ranked list read
                                as ranked rather than as shuffled. }}
                            {{row.parts.before}}<mark
                              class='hit'
                            >{{row.parts.match}}</mark>{{row.parts.after}}
                          </span>
                          {{#if row.option.description}}
                            <span
                              class='option-description'
                            >{{row.option.description}}</span>
                          {{/if}}
                        {{/if}}
                        <svg
                          class='check'
                          viewBox='0 0 12 12'
                          aria-hidden='true'
                          focusable='false'
                        >
                          <path
                            d='M2.5 6.5 5 9l4.5-5'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='1.75'
                            stroke-linecap='round'
                            stroke-linejoin='round'
                          />
                        </svg>
                      </li>
                    {{/each}}
                  </ul>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .ok-select {
        /* Every fallback stated exactly once, here at the root. Reads below
           are bare var(), so a theme can move any of these without this file
           carrying a second opinion about the default. */
        --ok-surface: var(--card, #ffffff);
        --ok-surface-ink: var(--card-foreground, #1c1e26);
        --ok-field: var(--input, #ffffff);
        --ok-ink: var(--foreground, #1c1e26);
        --ok-ink-2: var(--muted-foreground, #6b6f80);
        --ok-line: var(--border, #dfe1ea);
        --ok-accent: var(--primary, #3d6bff);
        --ok-accent-ink: var(--primary-foreground, #ffffff);
        --ok-hover: var(--accent, #eef1fb);
        --ok-ring: var(--ring, #6a7cff);
        --ok-radius: var(--boxel-border-radius-sm, 0.5rem);
        --ok-pad-y: var(--boxel-sp-5xs, 0.25rem);
        --ok-pad-x: var(--boxel-sp-4xs, 0.35rem);
        --ok-gap: var(--boxel-sp-6xs, 0.125rem);
        --ok-font: var(--font-sans, system-ui, sans-serif);
        --ok-size: var(--boxel-font-size, 0.875rem);
        --ok-size-sm: var(--boxel-font-size-xs, 0.6875rem);
        /* The hairline and the elevation are ONE token, so raising a surface
           can never leave its outline behind. Taken from the reference
           design, where nothing sets `border` at all. */
        --ok-shadow-popup: 0 0 0 1px var(--ok-line),
          0 4px 16px rgb(0 0 0 / 0.12);

        position: relative;
        display: inline-block;
        min-width: 12rem;
        font-family: var(--ok-font);
        font-size: var(--ok-size);
      }

      .trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ok-pad-x);
        width: 100%;
        padding: var(--ok-pad-y) var(--ok-pad-x);
        border: 1px solid var(--ok-line);
        border-radius: var(--ok-radius);
        background-color: var(--ok-field);
        color: var(--ok-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .trigger:focus-visible {
        outline: 2px solid var(--ok-ring);
        outline-offset: 1px;
      }
      .trigger:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .trigger.is-placeholder {
        color: var(--ok-ink-2);
      }
      .trigger-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .caret {
        flex: none;
        width: 0.75rem;
        height: 0.75rem;
        color: var(--ok-ink-2);
        transition: transform 120ms ease;
      }
      .trigger[aria-expanded='true'] .caret {
        transform: rotate(180deg);
      }

      .popup {
        position: absolute;
        z-index: 5;
        top: calc(100% + var(--ok-gap));
        left: 0;
        right: 0;
        border-radius: var(--ok-radius);
        background-color: var(--ok-surface);
        color: var(--ok-surface-ink);
        box-shadow: var(--ok-shadow-popup);
        overflow: hidden;
      }

      /* ── search ── */
      .search {
        display: flex;
        align-items: center;
        gap: var(--ok-pad-x);
        padding: var(--ok-pad-y) var(--ok-pad-x);
        /* A hairline drawn as a shadow for the same reason as the popup's:
           borders and elevation stay one decision. */
        box-shadow: 0 1px 0 0 var(--ok-line);
      }
      .search-icon {
        flex: none;
        width: 0.75rem;
        height: 0.75rem;
        color: var(--ok-ink-2);
      }
      .search-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: none;
        color: var(--ok-ink);
        font: inherit;
        /* The field's affordance is the popup it sits in. A second focus ring
           inside an already-raised surface is noise, and the caret is the
           unambiguous signal of where typing lands. */
        outline: none;
      }
      .search-input::placeholder {
        color: var(--ok-ink-2);
      }

      .listbox {
        max-height: 15rem;
        margin: 0;
        padding: var(--ok-gap);
        overflow-y: auto;
        list-style: none;
      }
      .section,
      .section-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .section-heading {
        position: sticky;
        /* Sticky headers, because the point of a group is knowing which one
           you are in — and that is precisely the thing scrolling takes away. */
        top: calc(-1 * var(--ok-gap));
        z-index: 1;
        margin: 0;
        padding: var(--ok-pad-y) var(--ok-pad-x) var(--ok-gap);
        background-color: var(--ok-surface);
        color: var(--ok-ink-2);
        font-size: var(--ok-size-sm);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .option {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 0 var(--ok-pad-x);
        padding: var(--ok-pad-y) var(--ok-pad-x);
        border-radius: calc(var(--ok-radius) - 0.125rem);
        cursor: pointer;
      }
      /* Hover and keyboard-active are the SAME affordance on purpose: a user
         who reaches for the mouse mid-keyboard should not see two highlights
         and have to work out which one Enter would take. */
      .option:hover,
      .option.is-active {
        background-color: var(--ok-hover);
      }
      .option.is-disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .option-label {
        grid-column: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hit {
        /* Weight and colour, not a highlighter block: the marked run has to
           read as part of the word, or the label becomes harder to scan than
           it was before the filter helped. */
        background: none;
        color: var(--ok-accent);
        font-weight: 700;
      }
      .option-description {
        grid-column: 1;
        color: var(--ok-ink-2);
        font-size: var(--ok-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .check {
        grid-column: 2;
        grid-row: 1 / -1;
        width: 0.75rem;
        height: 0.75rem;
        color: var(--ok-accent);
        /* Reserved, not conditional: showing the tick by adding an element
           would reflow every row as the selection moves. */
        visibility: hidden;
      }
      .option.is-selected .check {
        visibility: visible;
      }

      .state {
        display: flex;
        align-items: center;
        gap: var(--ok-pad-x);
        margin: 0;
        padding: var(--ok-pad-y) var(--ok-pad-x);
        color: var(--ok-ink-2);
      }
      .shimmer {
        width: 1rem;
        height: 0.5rem;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--ok-line),
          var(--ok-hover),
          var(--ok-line)
        );
        background-size: 200% 100%;
        animation: ok-shimmer 1.1s linear infinite;
      }
      @keyframes ok-shimmer {
        to {
          background-position: -200% 0;
        }
      }
      /* Motion here carries no information — it says "still working", which
         the text already says. So it goes entirely, rather than slowing down. */
      @media (prefers-reduced-motion: reduce) {
        .caret {
          transition: none;
        }
        .shimmer {
          animation: none;
        }
      }
    </style>
  </template>
}

function keyOf(option: SelectOption | undefined): string | undefined {
  if (!option) {
    return undefined;
  }
  return option.key ?? option.label;
}

// Case- and diacritic-insensitive comparison form. NFD splits a precomposed
// character into base + combining mark, and the mark is then dropped — so
// `México` folds to `mexico` WITHOUT changing length, which is what lets
// `splitMatch` slice the ORIGINAL string using indices found in the folded
// one. (Precomposed text is what browsers hand you; decomposed input would
// shift the indices, and the mark would simply not be found.)
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Which band a match falls in, or `undefined` for no match at all. Descriptions
// are searched too — a user typing `payment terms` is looking for the option
// whose explanation says that, and refusing to look there is the difference
// between a filter that helps and one that has to be outguessed.
function rankOption(option: SelectOption, needle: string): number | undefined {
  let label = fold(option.label ?? '');
  if (label.startsWith(needle)) {
    return RANK_PREFIX;
  }
  // A word boundary counts as a prefix hit for the word, which is how `ruble`
  // is found by `rub` in `Belarusian ruble` without demanding the first word.
  if (new RegExp(`\\b${escapeRegExp(needle)}`).test(label)) {
    return RANK_WORD;
  }
  if (label.includes(needle)) {
    return RANK_SUBSTRING;
  }
  // Description matches rank below every label match, always: a hit in the
  // small grey text is weaker evidence than a hit in the name.
  if (fold(option.description ?? '').includes(needle)) {
    return RANK_SUBSTRING + 1;
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Split a label around the matched run so the template can mark it without a
// helper. Returns the whole label as `before` when there is nothing to mark,
// which keeps the template's three-span shape constant across every render.
function splitMatch(
  label: string,
  needle: string,
): { before: string; match: string; after: string } {
  if (!needle) {
    return { before: label, match: '', after: '' };
  }
  let at = fold(label).indexOf(needle);
  if (at === -1) {
    return { before: label, match: '', after: '' };
  }
  return {
    before: label.slice(0, at),
    match: label.slice(at, at + needle.length),
    after: label.slice(at + needle.length),
  };
}

// A printable single character with no modifier held. Excludes Ctrl/Meta so
// browser shortcuts keep working, and excludes Alt so composed characters on
// non-US layouts are not swallowed as typeahead.
function isTypeaheadKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key !== ' '
  );
}
