import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import Modifier from 'ember-modifier';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';

// openkit/controls — layer 03, Reusable Semantic Building Blocks.
//
// <Select>, pass 3 — and the release that earns a 1.0.0.
//
// ─── WHY THIS IS A MAJOR ────────────────────────────────────────────────────
//
// 0.2.0 shipped with one gap it could not close additively, and it said so:
// "a short scroll container still clips the listbox". That is not a polish
// item. A select inside a card, inside a stack item, inside a scroll region —
// which is every select in this system — opens a popup that the nearest
// `overflow: hidden` ancestor cuts in half. No amount of z-index fixes it;
// z-index orders siblings, and this is a clipping problem, not an ordering
// one. The only fix is to stop being a descendant.
//
// So the listbox is now PORTALED to <body>. And that is a breaking change for
// an honest reason rather than a bookkeeping one:
//
//   1. THE DOM CONTRACT CHANGED. For a component library the rendered tree IS
//      public API. Any consumer stylesheet that reached the popup as a
//      descendant — `.my-form .ok-select .popup { … }` — silently stops
//      matching, and silently is the worst way for CSS to fail. A consumer
//      must read this note and re-aim, which is exactly what a major is for.
//   2. THE CASCADE CHANGED. A portaled element inherits from <body>, not from
//      the trigger's ancestors. Themes that were reaching the popup by
//      inheritance now do not. See the token block below, which is declared
//      TWICE for precisely this reason — the honest cost of portaling, paid
//      once and written down rather than discovered.
//   3. `@onChange` WIDENED. With `@multiple`, it hands back an array. Callers
//      that destructured a single option need to look at what they were
//      given.
//
// Riding along, because a major is when you get to do this: MULTIPLE
// SELECTION, which would have been a minor on its own and is folded in here
// rather than held back to invent a separate release.
//
// ─── WHAT IS PROVEN, AND WHAT IS OURS ───────────────────────────────────────
//
// Positioning is `@floating-ui/dom` — flip, shift, size and autoUpdate, the
// same engine the modern reference libraries use. Collision handling is a
// genuinely hard problem with a decade of edge cases in it (a scrolled
// container, a transformed ancestor, a virtual keyboard, a popup taller than
// the viewport), and there is nothing to be gained by discovering them again.
//
// What openkit owns is what openkit should own: the API, the ARIA, the
// keyboard, the visual language. `@cardstack/boxel-ui`'s select extends
// `PowerSelectArgs` — its arguments are an addon's arguments and its behaviour
// is a build-time dependency of the host. This one's are ours, and every part
// of it a consumer can pin to a version.
//
// ─── THE ARIA PATTERN ───────────────────────────────────────────────────────
//
// Focus never leaves the control's one focusable element — the trigger, or the
// search input when there is one. The current option is named by
// `aria-activedescendant`, not by moving DOM focus into the list. That is the
// APG combobox pattern and the one that survives contact with reality: moving
// real focus into a popup fights the browser over Tab order, breaks on iOS,
// and loses the caret. Portaling makes this MORE important, not less — the
// popup is no longer a DOM descendant, so focus moving there would put the
// user somewhere the trigger cannot explain.
//
// ─── MOTION ─────────────────────────────────────────────────────────────────
//
// The highlight travels instead of snapping. That is allowed under the rule
// this pack works to — motion is permitted where it encodes a state
// transition the reader would otherwise have to infer, and forbidden where it
// decorates. Here it encodes CONTINUITY: a highlight that slides from row 3 to
// row 4 shows the reader they moved by one, which is the exact fact a snap
// leaves them to reconstruct. Behind `prefers-reduced-motion`, with the end
// state as the fallback, so nothing is lost by turning it off.

export interface SelectOption {
  /** Stable identity. Falls back to the label when absent. */
  key?: string;
  label: string;
  /** Secondary line, rendered smaller under the label. */
  description?: string;
  disabled?: boolean;
  /** Options sharing a group render under one header, in first-appearance
   *  order. Ungrouped options come first, headerless. */
  group?: string;
  /** Anything the caller wants back in `onChange`. */
  value?: unknown;
}

interface SelectSignature {
  Args: {
    options: SelectOption[];
    /** BREAKING in 1.0.0: an array when `@multiple` is set. */
    selected?: SelectOption | SelectOption[] | undefined;
    /** BREAKING in 1.0.0: hands back an array when `@multiple` is set. */
    onChange: (selection: SelectOption | SelectOption[]) => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    /** Nothing to choose from AT ALL — distinct from `@noMatchesMessage`,
     *  which is "your search removed everything". A user can act on the
     *  difference, so the component never collapses them. */
    emptyMessage?: string;
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    noMatchesMessage?: string;
    /** Return a rank (lower sorts higher) or `undefined` to exclude. Escape
     *  hatch for searching a field this component cannot see. */
    matcher?: (option: SelectOption, term: string) => number | undefined;

    // ── new in 1.0.0 ──
    multiple?: boolean;
    /** Show the first N chips, then "+N more". Keeps a trigger from growing
     *  to fill the card when someone selects forty things. */
    maxVisibleChips?: number;
    /** `bottom-start` unless told otherwise; floating-ui flips it when the
     *  viewport says so, so this is a preference and not an instruction. */
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  };
  Blocks: {
    option: [SelectOption];
    trigger: [SelectOption | SelectOption[] | undefined];
  };
  Element: HTMLDivElement;
}

// Close when a click lands anywhere outside. Portaling makes this trickier and
// the trick is worth naming: the popup is no longer inside the component's
// element, so "outside" is now TWO elements, and a naive containment check
// closes the popup the instant you click an option in it.
class OnClickOutside extends Modifier<{
  Args: { Positional: [() => void, () => Element | undefined] };
}> {
  private handler?: (event: MouseEvent) => void;

  modify(element: Element, [callback, popup]: [() => void, () => Element | undefined]) {
    if (!this.handler) {
      this.handler = (event: MouseEvent) => {
        let target = event.target as Node | null;
        if (!target) {
          return;
        }
        if (element.contains(target)) {
          return;
        }
        let floating = popup();
        if (floating?.contains(target)) {
          return;
        }
        callback();
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

// Anchor the portaled popup to the trigger, and keep it anchored.
//
// `autoUpdate` is the part that is easy to leave out and impossible to live
// without: it re-runs the placement on scroll, on resize, and on any ancestor
// that moves. Without it the popup is correct exactly once — at the moment it
// opened — and then floats away from its trigger the first time anything
// scrolls, which in a card stack is immediately.
class AnchorTo extends Modifier<{
  Args: {
    Positional: [HTMLElement | undefined];
    Named: { placement?: string };
  };
}> {
  private stop?: () => void;

  modify(
    floating: Element,
    [reference]: [HTMLElement | undefined],
    named: { placement?: string },
  ) {
    this.stop?.();
    if (!reference) {
      return;
    }
    let element = floating as HTMLElement;
    this.stop = autoUpdate(reference, element, () => {
      computePosition(reference, element, {
        placement: (named.placement ?? 'bottom-start') as never,
        middleware: [
          offset(4),
          // Flip before shift: a popup that would hang off the bottom belongs
          // above the trigger, not nudged up to overlap it.
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ rects, availableHeight, elements }) {
              Object.assign(elements.floating.style, {
                // Match the trigger's width, the way a native select does —
                // a popup narrower or wider than its trigger reads as a
                // different control.
                minWidth: `${rects.reference.width}px`,
                // Never taller than the space there is. This is what stops a
                // long list from running off-screen with no way to reach the
                // end.
                maxHeight: `${Math.max(120, availableHeight)}px`,
              });
            },
          }),
        ],
      }).then(({ x, y }) => {
        Object.assign(element.style, { left: `${x}px`, top: `${y}px` });
      });
    });
    registerDestructor(this, () => this.stop?.());
  }
}

// Hand an element back to the component. Needed because the portaled popup has
// to be positioned against the trigger, and the trigger is in a different tree.
class Capture extends Modifier<{
  Args: { Positional: [(element: HTMLElement | undefined) => void] };
}> {
  modify(element: Element, [sink]: [(el: HTMLElement | undefined) => void]) {
    sink(element as HTMLElement);
    registerDestructor(this, () => sink(undefined));
  }
}

// Keep the active option in view, and move the sliding highlight to it.
//
// Both jobs in one modifier because they are one fact — where the active row
// is — and reading it twice from two places is how they drift apart.
class TrackActive extends Modifier<{
  Args: { Positional: [boolean] };
}> {
  modify(element: Element, [isActive]: [boolean]) {
    if (!isActive) {
      return;
    }
    let row = element as HTMLElement;
    // `nearest`, not `center`: centring makes every arrow press move the whole
    // list, and the reader loses their place.
    row.scrollIntoView({ block: 'nearest' });
    let list = row.closest('.listbox') as HTMLElement | null;
    if (list) {
      // Written as custom properties rather than by styling a second element,
      // so the highlight is one absolutely-positioned box the CSS transitions
      // — no per-row animation state, nothing to clean up.
      list.style.setProperty('--ok-active-top', `${row.offsetTop}px`);
      list.style.setProperty('--ok-active-height', `${row.offsetHeight}px`);
      list.dataset.hasActive = 'true';
    }
  }
}

// Move the caret into the search field as it appears. Without this the field is
// visible and inert, which is worse than not having one.
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

// Rank bands. Named rather than inlined, because the ORDER of these bands is
// the search's entire user-visible personality and it should be legible in one
// place.
const RANK_PREFIX = 0; // "us" → "USD"
const RANK_WORD = 1; // "ru" → "Belarusian ruble"
const RANK_SUBSTRING = 2; // anywhere in the label
const RANK_DESCRIPTION = 3; // only in the small grey text

export default class Select extends Component<SelectSignature> {
  @tracked isOpen = false;
  // The option the KEYBOARD is on, which is not the selected one. Conflating
  // the two is the classic listbox bug: arrowing through a list would commit a
  // value the user was only looking at.
  @tracked activeIndex = -1;
  @tracked query = '';
  @tracked triggerElement: HTMLElement | undefined;
  @tracked popupElement: HTMLElement | undefined;

  private typeahead = '';
  private typeaheadAt = 0;
  private id = `ok-select-${Math.random().toString(36).slice(2, 9)}`;

  get listboxId() {
    return `${this.id}-listbox`;
  }

  // Where the popup goes. <body> rather than a dedicated portal root: a portal
  // root is one more thing an embedding application has to install correctly,
  // and a card cannot assume its host installed one.
  get portalTarget() {
    return document.body;
  }

  @action captureTrigger(element: HTMLElement | undefined) {
    this.triggerElement = element;
  }

  @action capturePopup(element: HTMLElement | undefined) {
    this.popupElement = element;
  }

  @action getPopup() {
    return this.popupElement;
  }

  get allOptions(): SelectOption[] {
    return this.args.options ?? [];
  }

  get isMultiple() {
    return this.args.multiple === true;
  }

  get isSearchable() {
    return this.args.searchable === true;
  }

  get isDisabled() {
    return this.args.disabled === true;
  }

  // One shape for both modes, so nothing below has to ask which mode it is in.
  get selectedList(): SelectOption[] {
    let selected = this.args.selected;
    if (selected === undefined) {
      return [];
    }
    return Array.isArray(selected) ? selected : [selected];
  }

  private get selectedKeys(): Set<string> {
    return new Set(
      this.selectedList
        .map((option) => keyOf(option))
        .filter((key): key is string => key !== undefined),
    );
  }

  get hasSelection() {
    return this.selectedList.length > 0;
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
  // and not into `@options` — the one invariant that keeps search and arrow
  // keys from disagreeing about what row 3 is.
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
    // the groups were added to provide. Author order last, so equally good
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
    let selectedKeys = this.selectedKeys;
    let needle = fold(this.query.trim());
    return this.visible.map((option, index) => {
      let key = keyOf(option);
      return {
        option,
        index,
        id: `${this.id}-option-${index}`,
        isSelected: key !== undefined && selectedKeys.has(key),
        isActive: index === this.activeIndex,
        // Precomputed here rather than in the template: one pass over the list
        // instead of one comparison per option per render, and the template
        // stays free of helpers this pack deliberately does not import.
        parts: splitMatch(option.label, needle),
      };
    });
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

  // What the trigger shows in multiple mode, capped so selecting forty things
  // cannot make the trigger taller than the card it sits in.
  get chips() {
    let cap = this.args.maxVisibleChips ?? 3;
    return this.selectedList.slice(0, cap);
  }

  get overflowCount() {
    let cap = this.args.maxVisibleChips ?? 3;
    return Math.max(0, this.selectedList.length - cap);
  }

  get activeDescendantId() {
    return this.isOpen && this.activeIndex >= 0
      ? `${this.id}-option-${this.activeIndex}`
      : undefined;
  }

  get triggerLabel() {
    return this.selectedList[0]?.label ?? this.args.placeholder ?? 'Select…';
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
    let keys = this.selectedKeys;
    let at = this.visible.findIndex((o) => {
      let key = keyOf(o);
      return key !== undefined && keys.has(key);
    });
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
    if (!this.isMultiple) {
      this.args.onChange?.(option);
      this.close();
      return;
    }
    // Multiple selection stays OPEN. Closing after each pick would make
    // choosing five things a five-round trip, and the whole reason a user
    // asked for multiple is that they have more than one to choose.
    let key = keyOf(option);
    let next = this.selectedList.filter((o) => keyOf(o) !== key);
    if (next.length === this.selectedList.length) {
      next.push(option);
    }
    this.args.onChange?.(next);
  }

  @action removeChip(option: SelectOption, event: Event) {
    // The chip's remove button sits inside the trigger button. Without this the
    // click bubbles and reopens the popup the user just closed.
    event.stopPropagation();
    event.preventDefault();
    let key = keyOf(option);
    this.args.onChange?.(this.selectedList.filter((o) => keyOf(o) !== key));
  }

  @action onSearch(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
    // Re-aim at the best remaining row. Leaving the index where it was would
    // point `aria-activedescendant` at a row that no longer exists, which a
    // screen reader announces as nothing at all.
    this.activeIndex = this.nextSelectable(-1, 1);
  }

  // Skips disabled options and wraps. Wrapping is right for a listbox: the list
  // is a ring, and stopping dead at the end is a small unexplained failure
  // every time a user holds the key down.
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
        event.preventDefault();
        if (this.isSearchable) {
          this.open();
          this.query = key;
          this.activeIndex = this.nextSelectable(-1, 1);
          return;
        }
        let match = this.matchTypeahead(key);
        if (match) {
          this.args.onChange?.(this.isMultiple ? [match] : match);
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
      case 'Backspace':
        // Empty field, multiple mode: backspace removes the last chip. Borrowed
        // from every tag input worth using — the field is empty, so the key has
        // nothing else to do, and reaching for the mouse to drop one value is
        // the friction that makes multi-select tedious.
        if (searching && this.isMultiple && !this.query && this.hasSelection) {
          event.preventDefault();
          this.args.onChange?.(this.selectedList.slice(0, -1));
        }
        return;
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
        // With a search field the keystrokes are text, and `onSearch` has them.
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

    // Start the search AFTER the current position so a repeat advances instead
    // of landing on the same option forever.
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
    <div
      class='ok-select'
      {{OnClickOutside this.close this.getPopup}}
      ...attributes
    >
      <button
        type='button'
        class='trigger
          {{unless this.hasSelection "is-placeholder"}}
          {{if this.isMultiple "is-multiple"}}'
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
        {{Capture this.captureTrigger}}
        {{on 'click' this.toggle}}
        {{on 'keydown' this.onKeydown}}
      >
        <span class='trigger-text'>
          {{#if (has-block 'trigger')}}
            {{yield @selected to='trigger'}}
          {{else if this.isMultiple}}
            {{#if this.hasSelection}}
              {{#each this.chips key='label' as |chip|}}
                <span class='chip'>
                  <span class='chip-label'>{{chip.label}}</span>
                  {{! A <span role=button> inside a <button>: nesting real
                      buttons is invalid HTML and browsers recover from it by
                      dropping one. The keyboard path to removal is Backspace
                      in the field, which is why this needs no tabindex. }}
                  <span
                    class='chip-remove'
                    role='button'
                    aria-label='Remove {{chip.label}}'
                    {{on 'click' (fn this.removeChip chip)}}
                  >×</span>
                </span>
              {{/each}}
              {{#if this.overflowCount}}
                <span class='chip is-overflow'>+{{this.overflowCount}}</span>
              {{/if}}
            {{else}}
              {{if @placeholder @placeholder 'Select…'}}
            {{/if}}
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
    </div>

    {{#if this.isOpen}}
      {{! THE PORTAL. Rendered into <body> so no ancestor's overflow can clip
          it, positioned back onto the trigger by floating-ui. This is the
          breaking change, and it is the one that makes the component usable
          inside a scrolling card stack. }}
      {{#in-element this.portalTarget insertBefore=null}}
        <div
          class='ok-popup'
          {{Capture this.capturePopup}}
          {{AnchorTo this.triggerElement placement=@placement}}
        >
          {{#if this.isSearchable}}
            {{! With a field present, THIS is the combobox: it owns the caret,
                the activedescendant and the keyboard. The trigger steps down
                to a plain disclosure button. }}
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
              aria-multiselectable={{if this.isMultiple 'true' 'false'}}
            >
              {{! ONE highlight box for the whole list, moved by custom
                  properties. A per-row animation would need state on every row
                  and would still snap when rows are added or removed. }}
              <li class='highlight' role='presentation' aria-hidden='true'></li>
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
                        {{TrackActive row.isActive}}
                        {{on 'click' (fn this.choose row.option)}}
                      >
                        {{#if this.isMultiple}}
                          {{! A drawn box, not an <input type=checkbox>: the row
                              already carries aria-selected, and a real checkbox
                              inside a role=option is a second, contradictory
                              announcement of the same state. }}
                          <span class='box' aria-hidden='true'>
                            <svg viewBox='0 0 12 12' focusable='false'>
                              <path
                                d='M2.5 6.5 5 9l4.5-5'
                                fill='none'
                                stroke='currentColor'
                                stroke-width='1.75'
                                stroke-linecap='round'
                                stroke-linejoin='round'
                              />
                            </svg>
                          </span>
                        {{/if}}
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
                        {{#unless this.isMultiple}}
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
                        {{/unless}}
                      </li>
                    {{/each}}
                  </ul>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      {{/in-element}}
    {{/if}}

    <style scoped>
      /* THE TOKEN BLOCK IS DECLARED TWICE, and that is the actual price of the
         portal rather than an oversight. `.ok-popup` is a child of <body>, so
         it inherits nothing from `.ok-select` — custom properties cascade, and
         the popup left the cascade. Two roots, one list, stated once each.

         (The alternative — copying the computed values onto the popup in JS —
         would work and would also freeze the theme at open time, so a theme
         change with a popup open would leave it stale.) */
      .ok-select,
      .ok-popup {
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
           can never leave its outline behind. Taken from the reference design,
           where nothing sets `border` at all. */
        --ok-shadow-popup: 0 0 0 1px var(--ok-line),
          0 4px 16px rgb(0 0 0 / 0.12);
        --ok-motion: 140ms cubic-bezier(0.2, 0, 0, 1);
      }

      .ok-select {
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
      .trigger.is-multiple .trigger-text {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ok-gap);
        overflow: visible;
        white-space: normal;
      }

      /* Chips. The tint recipe is the reference design's — a mix of the accent
         into the surface, so a chip belongs to the surface it sits on rather
         than being a coloured rectangle dropped onto it.

         The reference mixes WHITE into the accent for the text, which works on
         its dark surface and washes out on a light one. Mixing toward the
         surface's own ink instead crosses over correctly in both directions,
         which is the one deviation from the reference here. */
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--ok-gap);
        max-width: 12rem;
        padding: 0 var(--ok-pad-x);
        border-radius: 999px;
        background: color-mix(in srgb, var(--ok-accent) 12%, var(--ok-surface));
        color: color-mix(in srgb, var(--ok-accent) 80%, var(--ok-surface-ink));
        font-size: var(--ok-size-sm);
        line-height: 1.6;
      }
      .chip-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip-remove {
        flex: none;
        cursor: pointer;
        opacity: 0.6;
      }
      .chip-remove:hover {
        opacity: 1;
      }
      .chip.is-overflow {
        color: var(--ok-ink-2);
        background: var(--ok-hover);
      }

      .caret {
        flex: none;
        width: 0.75rem;
        height: 0.75rem;
        color: var(--ok-ink-2);
        transition: transform var(--ok-motion);
      }
      .trigger[aria-expanded='true'] .caret {
        transform: rotate(180deg);
      }

      /* Positioned by floating-ui, which writes left/top. `position: fixed` so
         the coordinates are viewport coordinates and no scrolled ancestor has
         to be compensated for. */
      .ok-popup {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: var(--ok-radius);
        background-color: var(--ok-surface);
        color: var(--ok-surface-ink);
        box-shadow: var(--ok-shadow-popup);
        font-family: var(--ok-font);
        font-size: var(--ok-size);
      }

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
        position: relative;
        flex: 1;
        min-height: 0;
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
        /* Sticky headers, because the point of a group is knowing which one you
           are in — and that is precisely what scrolling takes away. */
        top: calc(-1 * var(--ok-gap));
        z-index: 2;
        margin: 0;
        padding: var(--ok-pad-y) var(--ok-pad-x) var(--ok-gap);
        background-color: var(--ok-surface);
        color: var(--ok-ink-2);
        font-size: var(--ok-size-sm);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      /* The travelling highlight. Hidden until something is active, so it does
         not fly in from the top-left on first open. */
      .highlight {
        position: absolute;
        left: var(--ok-gap);
        right: var(--ok-gap);
        top: 0;
        height: var(--ok-active-height, 0);
        border-radius: calc(var(--ok-radius) - 0.125rem);
        background-color: var(--ok-hover);
        transform: translateY(var(--ok-active-top, 0));
        transition: transform var(--ok-motion), height var(--ok-motion);
        opacity: 0;
        pointer-events: none;
      }
      .listbox[data-has-active='true'] .highlight {
        opacity: 1;
      }

      .option {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 0 var(--ok-pad-x);
        padding: var(--ok-pad-y) var(--ok-pad-x);
        border-radius: calc(var(--ok-radius) - 0.125rem);
        cursor: pointer;
      }
      /* Hover paints its own background because the pointer can be somewhere
         the keyboard is not; the travelling box is the KEYBOARD's position.
         They coincide whenever the pointer moves, since hovering also moves
         the active row — so two highlights are never visible at once. */
      .option:hover {
        background-color: var(--ok-hover);
      }
      .option.is-disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .box {
        grid-column: 1;
        grid-row: 1 / -1;
        display: grid;
        place-items: center;
        width: 0.85rem;
        height: 0.85rem;
        margin-right: var(--ok-pad-x);
        border: 1px solid var(--ok-line);
        border-radius: 0.2rem;
        color: var(--ok-accent-ink);
      }
      .box svg {
        width: 0.7rem;
        height: 0.7rem;
        visibility: hidden;
      }
      .option.is-selected .box {
        border-color: var(--ok-accent);
        background-color: var(--ok-accent);
      }
      .option.is-selected .box svg {
        visibility: visible;
      }
      /* The checkbox column exists only when there is a checkbox, asked of the
         row itself rather than inferred from the trigger — which after the
         portal is in a different tree entirely and no selector can reach. */
      .option:has(.box) {
        grid-template-columns: auto 1fr auto;
      }
      .option:has(.box) .option-label,
      .option:has(.box) .option-description {
        grid-column: 2;
      }

      .option-label {
        grid-column: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hit {
        /* Weight and colour, not a highlighter block: the marked run has to
           read as part of the word, or the label becomes harder to scan than it
           was before the filter helped. */
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
        grid-column: -1;
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
      @media (prefers-reduced-motion: reduce) {
        /* The end state is the fallback everywhere, so nothing is lost by
           turning motion off — the highlight still lands on the active row, it
           simply arrives there immediately. */
        .caret,
        .highlight {
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

// Which band a match falls in, or `undefined` for no match at all.
// Descriptions are searched too — a user typing `payment terms` is looking for
// the option whose explanation says that, and refusing to look there is the
// difference between a filter that helps and one that has to be outguessed.
function rankOption(option: SelectOption, needle: string): number | undefined {
  let label = fold(option.label ?? '');
  if (label.startsWith(needle)) {
    return RANK_PREFIX;
  }
  // A word boundary counts as a prefix hit for that word, which is how `ruble`
  // is found by `rub` in `Belarusian ruble` without demanding the first word.
  if (new RegExp(`\\b${escapeRegExp(needle)}`).test(label)) {
    return RANK_WORD;
  }
  if (label.includes(needle)) {
    return RANK_SUBSTRING;
  }
  // A hit in the small grey text is weaker evidence than a hit in the name, so
  // it always ranks below every label match.
  if (fold(option.description ?? '').includes(needle)) {
    return RANK_DESCRIPTION;
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
