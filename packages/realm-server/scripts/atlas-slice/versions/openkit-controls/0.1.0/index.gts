import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import Modifier from 'ember-modifier';

// openkit/controls — layer 03, Reusable Semantic Building Blocks.
//
// PASS 1: <Select>.
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
// THE ARIA PATTERN, AND WHY THIS ONE. Focus never leaves the trigger. The
// listbox is labelled, the options are identified, and the "current" option is
// named by `aria-activedescendant` on the trigger rather than by moving DOM
// focus into the list. That is the pattern the APG describes for a combobox,
// and it is the one that survives contact with reality: moving real focus into
// a popup fights the browser over Tab order, breaks on iOS, and loses the
// caret if the trigger is ever an input. One focus point, one keyboard
// handler, one place a screen reader is looking.
//
// WHAT PASS 1 DOES NOT DO, said plainly rather than discovered later:
// no multiple selection, no search field, no option groups, no portal (the
// listbox is positioned by CSS, so a short scroll container will clip it), and
// the highlight snaps rather than travels. Each is a later pass, and each is
// additive — which is what will make them MINOR versions rather than majors.
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
    /** What to say when there are no options at all — distinct from "your
     *  search matched nothing", which pass 1 does not have yet. */
    emptyMessage?: string;
    label?: string;
    /** Ties the trigger to an external <label>. */
    labelledBy?: string;
    describedBy?: string;
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

// How long a typeahead buffer survives. 500ms is the platform convention —
// long enough to type "gre" for Greece, short enough that a later unrelated
// "g" starts a fresh search rather than extending a stale one.
const TYPEAHEAD_WINDOW = 500;

export default class Select extends Component<SelectSignature> {
  @tracked isOpen = false;
  // The option the KEYBOARD is on, which is not the selected one. Conflating
  // the two is the classic listbox bug: arrowing through a list would commit
  // a value the user was only looking at.
  @tracked activeIndex = -1;

  private typeahead = '';
  private typeaheadAt = 0;
  private id = `ok-select-${Math.random().toString(36).slice(2, 9)}`;

  get listboxId() {
    return `${this.id}-listbox`;
  }

  get options(): SelectOption[] {
    return this.args.options ?? [];
  }

  get isEmpty() {
    return this.options.length === 0;
  }

  get isDisabled() {
    return this.args.disabled === true;
  }

  // Precomputed so the template never has to compare — a template comparison
  // would need a helper this pack deliberately does not import, and doing it
  // here means one pass instead of one per option per render.
  get rows() {
    let selectedKey = keyOf(this.args.selected);
    return this.options.map((option, index) => ({
      option,
      index,
      id: `${this.id}-option-${index}`,
      isSelected: selectedKey !== undefined && keyOf(option) === selectedKey,
      isActive: index === this.activeIndex,
    }));
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
    // Opening lands on the current selection, so Enter is a no-op rather than
    // a surprise. With nothing selected it lands on the first option a user
    // could actually choose.
    let selectedKey = keyOf(this.args.selected);
    let at = this.options.findIndex((o) => keyOf(o) === selectedKey);
    this.activeIndex = at >= 0 ? at : this.nextSelectable(-1, 1);
  }

  @action close() {
    this.isOpen = false;
    this.activeIndex = -1;
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

  // Skips disabled options and wraps. Wrapping is right for a listbox: the
  // list is a ring, and stopping dead at the end is a small unexplained
  // failure every time a user holds the key down.
  private nextSelectable(from: number, step: number): number {
    let count = this.options.length;
    if (count === 0) {
      return -1;
    }
    for (let hop = 1; hop <= count; hop++) {
      let index = (((from + step * hop) % count) + count) % count;
      if (!this.options[index]?.disabled) {
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

    if (!this.isOpen) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        this.open();
        return;
      }
      // Typeahead works CLOSED as well as open, which is how a native select
      // behaves and how anyone filling a long form actually uses one.
      if (isTypeaheadKey(event)) {
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
        event.preventDefault();
        this.activeIndex = this.nextSelectable(-1, 1);
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex = this.nextSelectable(this.options.length, -1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        let row = this.options[this.activeIndex];
        if (row) {
          this.choose(row);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Tab':
        // Closes but does NOT commit. Tab means "I am moving on", and
        // committing whatever the highlight happened to be sitting on is a
        // value the user never chose.
        this.close();
        break;
      default:
        if (isTypeaheadKey(event)) {
          event.preventDefault();
          let match = this.matchTypeahead(key);
          if (match) {
            this.activeIndex = this.options.indexOf(match);
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
    let prefix = (sameLetter ? this.typeahead[0] : this.typeahead).toLowerCase();

    // Start the search AFTER the current position so a repeat advances
    // instead of landing on the same option forever.
    let count = this.options.length;
    let from = sameLetter ? this.activeIndex : this.activeIndex - 1;
    for (let hop = 1; hop <= count; hop++) {
      let index = (((from + hop) % count) + count) % count;
      let option = this.options[index];
      if (
        option &&
        !option.disabled &&
        option.label?.toLowerCase().startsWith(prefix)
      ) {
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
        role='combobox'
        aria-expanded={{if this.isOpen 'true' 'false'}}
        aria-haspopup='listbox'
        aria-controls={{this.listboxId}}
        aria-activedescendant={{this.activeDescendantId}}
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
          {{#if @loading}}
            <p class='state' role='status'>
              <span class='shimmer'></span>
              Loading…
            </p>
          {{else if this.isEmpty}}
            {{! An empty list and a failed search are different problems and a
                user can act on the difference; pass 1 only has the first. }}
            <p class='state' role='status'>{{if
                @emptyMessage
                @emptyMessage
                'Nothing to choose from'
              }}</p>
          {{else}}
            <ul
              class='listbox'
              id={{this.listboxId}}
              role='listbox'
              aria-label={{@label}}
            >
              {{#each this.rows key='id' as |row|}}
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
                    <span class='option-label'>{{row.option.label}}</span>
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

      .listbox {
        max-height: 15rem;
        margin: 0;
        padding: var(--ok-gap);
        overflow-y: auto;
        list-style: none;
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
