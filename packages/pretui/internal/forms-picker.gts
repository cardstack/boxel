// Pretui — forms/picker territory: the RECORD-SELECTION controls the kit was
// missing. Layout and enterprise semantics ported from Salesforce Lightning
// Design System (BSD-3, (c) salesforce.com); the dropdown ENGINE under
// Lookup + Combobox is ember-power-select, reached through boxel-ui's
// `BoxelMultiSelectBasic`, exactly as Pretui's own `Select` rides
// `BoxelSelect` (see `Select`).
//
//   Lookup           ← slds lookups/ + combobox/ + combobox/listbox/
//                      + combobox/listbox-of-pills/   · engine: power-select
//   Combobox         ← the same engine over plain {value,label} options
//   DuelingPicklist  ← slds dueling-picklist/         · no dropdown, no engine
//
// WHY POWER-SELECT (wave-2 correction, Chris): the first cut hand-rolled the
// results panel on Popup + a backdrop button. It was janky and dismissed
// wrongly — outside-click, Escape, focus return and the open/close lifecycle
// are exactly the parts nobody should re-implement. power-select owns all of
// them, and it already ships the full editable-combobox ARIA set on its own
// trigger input (role=combobox, aria-expanded/controls/owns/haspopup,
// aria-autocomplete=list, aria-activedescendant) plus a
// `role=status aria-live=polite` region announcing the result count.
//
//   * `BoxelMultiSelectBasic`, not `BoxelMultiSelect` — the latter hard-codes
//     `@triggerComponent={{BoxelMultiSelectDefaultTrigger}}`, which renders
//     pills and a caret but NO search input. Basic leaves @triggerComponent
//     unset, so power-select's own multiple trigger renders, and that is the
//     one that puts the combobox <input> in the field (searchFieldPosition
//     resolves to 'trigger' whenever @multiple is true).
//   * `@renderInPlace={{true}}` is load-bearing: the wormhole path
//     (#ember-basic-dropdown-wormhole) only copies boxel's fixed variable
//     list onto the portal, so Pretui tokens (--popover, --hover, --field,
//     --pretui-*) would not travel and a season recompile could not re-dress
//     the dropdown. In place, the dropdown inherits every token naturally.
//     Accepted trade-off (same as Select): an overflow-hidden ancestor can
//     clip the dropdown.
//   * `:deep()` here is the sanctioned exception the kit already makes for
//     this engine — power-select owns the markup; Select re-dresses it the
//     same way.
//
// What SLDS got wrong, and what this file still fixes:
//  1. SLDS ships STATIC SNAPSHOTS — `isOpen`/`hasFocus`/`hasInteractions`
//     props exist only to freeze the React examples. Nothing dismisses,
//     nothing keyboards. power-select does both.
//  2. SLDS's `listbox-of-pills` makes each selected pill a `role='option'`
//     with a remove `<button>` inside it — `option` has children
//     presentational, so that button is never exposed. power-select's
//     multiple trigger instead removes via Backspace from the input plus a
//     per-pill remove control, and `RecordPill` (exported here) gives the
//     same job a real, individually named button wherever a selection is
//     shown outside a dropdown.
//  3. SLDS's term highlight is authored data (`beforeTerm`/`term`/`afterTerm`
//     hand-split into every snapshot). `RecordFace` derives it from the live
//     search text.
//  4. Single-select in SLDS replaces the input with a read-only faux
//     `<div role='combobox'>` (`selectOnly`), so replacing a value means
//     clicking ✕ first. Here the search input stays live beside the pill and
//     a second pick replaces the first.
//  5. SLDS's entity option computes its accessible name from the subtree,
//     folding icon titles into it; power-select names options from the block
//     text, and `RecordFace` keeps that text clean.
//  Dropped from SLDS on purpose: `slds-input_faux` / `selectOnly` (see 4),
//  the object-switcher addon and advanced-search modal (compose a `Menu` /
//  `Dialog` at the call site — this is the control, not the app), and the
//  `+6 more` selection-group toggle (a caller concern: slice @selected).
//
// Engine deltas — where power-select's behaviour wins over the hand-rolled
// first cut, and callers must know:
//  * The search text belongs to the engine. `@query` / `@defaultQuery` are
//    GONE; `@onSearch` still reports every keystroke (read off the
//    `registerAPI` public API, which power-select delivers in a microtask,
//    never during render).
//  * Filtering is LOCAL over the supplied `@records`, matched against a
//    synthesized `search` key (label + meta + id, or `record.search` when the
//    caller sets it). power-select only skips local filtering when given its
//    own `@search` arg, which neither boxel wrapper forwards. Callers doing
//    fuzzy or semantic server search must put anything that has to stay
//    findable into `record.search`.
//  * The result-count live region, the "No results found" row and the
//    highlight are the engine's. The polite region kept here announces only
//    selection changes, which the engine does not cover.
//  * `<:empty>` and `<:footer>` are gone (the engine owns the empty row;
//    `@afterOptionsComponent` cannot receive a block). `@labelledBy` /
//    `@describedBy` are gone — `BoxelMultiSelectBasic` forwards `@ariaLabel`
//    only, so `@label` is the naming channel.
//
// DuelingPicklist
//  1. SLDS ships MARKUP SNAPSHOTS ONLY — the keyboard model exists purely as
//     assistive text ("Press space bar when on an item, to move it within
//     the list…"); nothing implements it. Implemented here in full.
//  2. Its reorder is a MODAL grab/drop state entered with Space. A modal
//     keyboard mode is undiscoverable and strands anyone who forgets they
//     are in it. Replaced with a modeless Alt+ArrowUp/ArrowDown reorder;
//     Space keeps its listbox meaning (toggle selection).
//  3. Focus after a transfer is undefined upstream (a disabled move button
//     drops focus to <body>). Here focus follows the moved records into the
//     destination list via a render-time focus modifier — never the body.
//  4. `.slds-dueling-list__options` hard-codes `width/height: $size-small`.
//     Here the box is token-sized, the row count is an arg, and the whole
//     control restacks under an (unnamed) container query.
//  5. No move-all buttons upstream; both directions get one here.
//  Dropped: native HTML5 `draggable` on the options (a pointer-only path
//  with no keyboard equivalent and a `rotate(3deg)` grabbed transform that
//  ignores reduced motion) — the move/reorder buttons and the keyboard model
//  are the two complete paths.
//
// Realm-law notes: no fetching and no timers anywhere — the caller owns
// search and debouncing (@onSearch); the dropdown is positioned by
// ember-basic-dropdown under power-select; the only container query is
// unnamed.
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the forms-picker group)

// Pretui — the picker record shape and the power-select engine Lookup and Combobox share.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { BoxelMultiSelectBasic } from '@cardstack/boxel-ui/components';
import type { ComboboxOption } from '../components/combobox';
import { RecordFace } from '../components/record-face';

// ── PickerRecord ─────────────────────────────────────────────────────────
/**
 * One selectable record. Deliberately a PLAIN VALUE, not a CardDef/FieldDef
 * instance — a picker must be usable before a schema exists (the lesson from
 * the minimum-otter attempt). Salesforce shapes map onto it directly:
 * `id` ← the 18-char record id, `label` ← the Name field, `meta` ← the
 * secondary line SLDS renders as "Account • San Francisco".
 */
export interface PickerRecord {
  /** Stable identity. Selection, ordering and dedupe all key on this. */
  id: string;
  /** Primary line. The only part the term highlight searches. */
  label: string;
  /** Secondary line — object type, owner, location, whatever disambiguates. */
  meta?: string;
  /** Icon NAME from icon-registry (`iconFor`). Falls back to an initials Avatar. */
  icon?: string;
  /**
   * What the dropdown's local filter matches against. Defaults to
   * `label meta id`. Set it when the server matched on something the visible
   * text does not contain (synonyms, account numbers, fuzzy hits) — otherwise
   * power-select's local pass would hide the row the server just returned.
   */
  search?: string;
  /** DuelingPicklist only: the record cannot be transferred out of its list. */
  locked?: boolean;
}

export function phraseFor(labels: string[]): string {
  if (labels.length === 0) {
    return 'No items';
  }
  if (labels.length === 1) {
    return labels[0] as string;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  if (labels.length <= 4) {
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }
  return `${labels.length} items`;
}
// ── The power-select engine ──────────────────────────────────────────────
// Type-only cast, mirroring Select's `PoweredSelect`: the CLI's
// bundled boxel-ui types import PowerSelectArgs from ember-power-select,
// which the realm type env cannot resolve, so BoxelMultiSelectBasic's
// visible args collapse. Re-assert the surface we actually use; runtime is
// the real BoxelMultiSelectBasic.
//
// `@triggerComponent` is deliberately NOT in this list and never passed —
// leaving it unset is what makes power-select render its own multiple
// trigger, the one with the combobox <input> in the field.

/** The slice of power-select's public API this file reads. */
export interface PickerSelectApi {
  searchText?: string;
  isOpen?: boolean;
  actions?: { close?: () => void; open?: () => void };
}

interface PoweredPickerSignature<T> {
  Args: {
    options: T[];
    selected: T[];
    onChange: (selection: T[], select: PickerSelectApi, event?: Event) => void;
    placeholder?: string;
    disabled?: boolean;
    searchEnabled?: boolean;
    searchField?: string;
    closeOnSelect?: boolean;
    matchTriggerWidth?: boolean;
    renderInPlace?: boolean;
    dropdownClass?: string;
    ariaLabel?: string;
    registerAPI?: (select: PickerSelectApi) => void;
    onOpen?: (select: PickerSelectApi, event?: Event) => void;
    onClose?: (select: PickerSelectApi, event?: Event) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
    // component arg is a power-select subcomponent contract the realm type
    // env cannot express; runtime shape is checked by the engine.
    selectedItemComponent?: any;
  };
  Blocks: { default: [T, PickerSelectApi] };
  Element: HTMLElement;
}

export const PoweredRecordPicker = BoxelMultiSelectBasic as unknown as new (
  owner: unknown,
  args: PoweredPickerSignature<PickerRecord>['Args'],
) => Component<PoweredPickerSignature<PickerRecord>>;

export const PoweredValuePicker = BoxelMultiSelectBasic as unknown as new (
  owner: unknown,
  args: PoweredPickerSignature<ComboboxOption>['Args'],
) => Component<PoweredPickerSignature<ComboboxOption>>;

// The selected-item component power-select renders inside each trigger pill.
// Given as a component (not a block) so the pill dress differs from the
// option-row dress; power-select yields the same block to both otherwise.
interface SelectedRecordSignature {
  Args: { selected: PickerRecord; select?: PickerSelectApi };
}
export const SelectedRecord: TemplateOnlyComponent<SelectedRecordSignature> = <template>
  <RecordFace @record={{@selected}} @size='sm' />
</template>;

interface SelectedValueSignature {
  Args: { selected: ComboboxOption; select?: PickerSelectApi };
}
export const SelectedValue: TemplateOnlyComponent<SelectedValueSignature> = <template>
  <span class='pretui-cbx-pilltext'>{{@selected.label}}</span>
  <style scoped>
    @layer PretComponent {
      .pretui-cbx-pilltext {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        white-space: nowrap;
      }
    }
  </style>
</template>;
