// Pretui — Lookup: search-and-pick for records, single or multiple.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { Spinner } from './spinner';
import { RecordFace } from './record-face';
import { PoweredRecordPicker, SelectedRecord } from '../internal/forms-picker';
import type { PickerRecord, PickerSelectApi } from '../internal/forms-picker';

// ── Lookup ───────────────────────────────────────────────────────────────
// ARIA pattern: **editable combobox with a listbox popup, list autocomplete,
// managed with `aria-activedescendant`** — supplied whole by power-select's
// own multiple trigger (`role='combobox'` on the input, `aria-expanded`,
// `aria-controls`/`aria-owns` → the listbox, `aria-haspopup='listbox'`,
// `aria-autocomplete='list'`, `aria-activedescendant` → the highlighted
// option; `role='listbox'` with `role='option'` rows). DOM focus stays in the
// input. Keyboard, dismissal, outside-click, Escape and focus return are the
// engine's; Backspace on an empty input removes the last pill.
//
// Documented ARIA delta, deferring to the engine rather than fighting it:
// power-select sets `aria-multiselectable='true'` on the listbox whenever
// `@selected` is an array, which it always is here — so a single-select
// Lookup advertises multi-selectability. The alternative (a hand-rolled
// listbox) is what this rebuild removed.
//
// The component owns NO fetching: @records / @loading are supplied, @onSearch
// is emitted, and the caller debounces (realm law: no timers).

export interface LookupSignature {
  Args: {
    /** Result records to show, already filtered/sorted by the caller. */
    records: PickerRecord[];
    /** Controlled selection. Single-select is simply an array of 0 or 1. */
    selected?: PickerRecord[];
    /** Uncontrolled initial selection; ignored once @selected is supplied. */
    defaultSelected?: PickerRecord[];
    /** Allow more than one record. Single-select replaces on each pick. */
    multiple?: boolean;
    /** Async in flight — spins the trigger affix and announces "Searching…". */
    loading?: boolean;
    /** Blocks every interaction. */
    disabled?: boolean;
    /** Error dress plus aria-invalid (issues render in the field wrapper). */
    invalid?: boolean;
    /** Accessible name for the combobox input. */
    label?: string;
    /** Input placeholder. */
    placeholder?: string;
    /** Noun for the announcements, e.g. 'account'. */
    recordNoun?: string;
    /** Emitted on every keystroke. Debounce and fetch HERE, not in the component. */
    onSearch?: (query: string) => void;
    /** Emitted with the full selection after every pick/remove. */
    onSelectionChange?: (records: PickerRecord[]) => void;
    /** Emitted when the results dropdown opens or closes. */
    onOpenChange?: (open: boolean) => void;
  };
  Blocks: {
    /** Replace the default result row. Yields the record and its state. */
    option: [record: PickerRecord, state: { selected: boolean; term: string }];
  };
  Element: HTMLDivElement;
}

export class Lookup extends Component<LookupSignature> {
  uid = guidFor(this);
  @tracked internalSelected: PickerRecord[] = this.args.defaultSelected ?? [];
  @tracked lastAction = '';
  @tracked term = '';
  /**
   * Identity cache. power-select decides "is this option selected?" and
   * "add or remove?" by OBJECT IDENTITY, so the decorated options it sees
   * must be the same instances across renders — a fresh `{...record}` every
   * render would silently break toggling. Keyed by record id, refreshed when
   * the visible content changes.
   */
  optionCache = new Map<string, PickerRecord>();

  get noun() {
    return this.args.recordNoun ?? 'record';
  }
  get label() {
    return this.args.label ?? `Search ${this.noun}s`;
  }
  get placeholder() {
    return this.args.placeholder ?? 'Search…';
  }
  get selected(): PickerRecord[] {
    return this.args.selected ?? this.internalSelected;
  }
  get records() {
    return this.args.records ?? [];
  }
  get options(): PickerRecord[] {
    return this.records.map(this.decorate);
  }
  get selectedOptions(): PickerRecord[] {
    return this.selected.map(this.decorate);
  }
  /**
   * Selection changes only. The result count, the highlight and the
   * "No results found" row all come from power-select's own
   * `role='status'` region — duplicating them would double-speak.
   */
  get announcement() {
    if (this.args.loading) {
      return `${this.lastAction} Searching…`.trim();
    }
    return this.lastAction;
  }

  decorate = (record: PickerRecord): PickerRecord => {
    let hit = this.optionCache.get(record.id);
    if (
      hit &&
      hit.label === record.label &&
      hit.meta === record.meta &&
      hit.icon === record.icon
    ) {
      return hit;
    }
    // bounded: a long session of searches must not grow this without limit
    if (this.optionCache.size > 400) {
      this.optionCache.clear();
    }
    let made: PickerRecord = {
      ...record,
      search: record.search ?? `${record.label} ${record.meta ?? ''} ${record.id}`,
    };
    this.optionCache.set(record.id, made);
    return made;
  };
  isSelected = (record: PickerRecord) =>
    this.selected.some((r) => r.id === record.id);
  optionState = (record: PickerRecord) => ({
    selected: this.isSelected(record),
    term: this.term,
  });
  /**
   * power-select hands its public API back through registerAPI in a
   * MICROTASK it schedules itself (never during render), which makes this the
   * safe place to lift `searchText` out of the engine and into @onSearch.
   * There is no supported way to push search text back in, which is why
   * @query / @defaultQuery are gone.
   */
  registerApi = (select: PickerSelectApi) => {
    let next = select?.searchText ?? '';
    if (next !== this.term) {
      this.term = next;
      this.args.onSearch?.(next);
    }
  };
  handleChange = (selection: PickerRecord[]) => {
    let next = this.args.multiple ? selection : selection.slice(-1);
    let before = this.selected;
    if (this.args.selected === undefined) {
      this.internalSelected = next;
    }
    let added = next.filter((r) => !before.some((b) => b.id === r.id));
    let removed = before.filter((b) => !next.some((r) => r.id === b.id));
    if (added.length) {
      this.lastAction = `${added.map((r) => r.label).join(', ')} selected.`;
    } else if (removed.length) {
      this.lastAction = `${removed.map((r) => r.label).join(', ')} removed.`;
    }
    this.args.onSelectionChange?.(next);
  };
  handleOpen = () => {
    this.args.onOpenChange?.(true);
  };
  handleClose = () => {
    this.args.onOpenChange?.(false);
  };

  <template>
    <div
      class='pretui-lookup'
      data-disabled={{if @disabled 'true'}}
      data-invalid={{if @invalid 'true'}}
      data-loading={{if @loading 'true'}}
      data-test-pretui-lookup
      ...attributes
    >
      <PoweredRecordPicker
        class='pretui-pickertrigger'
        aria-invalid={{if @invalid 'true'}}
        @options={{this.options}}
        @selected={{this.selectedOptions}}
        @onChange={{this.handleChange}}
        @placeholder={{this.placeholder}}
        @disabled={{@disabled}}
        @searchEnabled={{true}}
        @searchField='search'
        @closeOnSelect={{if @multiple false true}}
        @matchTriggerWidth={{true}}
        @renderInPlace={{true}}
        @dropdownClass='pretui-picker-dropdown'
        @ariaLabel={{this.label}}
        @registerAPI={{this.registerApi}}
        @onOpen={{this.handleOpen}}
        @onClose={{this.handleClose}}
        @selectedItemComponent={{SelectedRecord}}
        as |record|
      >
        {{#if (has-block 'option')}}
          {{yield record (this.optionState record) to='option'}}
        {{else}}
          <RecordFace @record={{record}} @term={{this.term}} />
        {{/if}}
      </PoweredRecordPicker>

      {{#if @loading}}
        <span class='pretui-picker-busy' aria-hidden='true'>
          <Spinner @size={{13}} />
        </span>
      {{/if}}

      <div
        class='pretui-picker-live'
        role='status'
        aria-live='polite'
        aria-atomic='true'
        data-test-pretui-lookup-live
      >{{this.announcement}}</div>
    </div>
    <style scoped>
      @layer PretComponent {
        /* power-select owns this markup, so :deep() is the channel — the same
           sanctioned exception Select makes. Every value still
           comes from a Pretui token, so a season recompile re-dresses it. */
        .pretui-lookup {
          position: relative; /* anchors the in-place dropdown */
          display: block;
          min-width: 0;
          --boxel-form-control-border-radius: var(--radius);
          --boxel-border-radius-sm: var(--radius);
          --boxel-select-trigger-padding: 0;
          --boxel-dropdown-background-color: var(--popover);
          --boxel-dropdown-text-color: var(--foreground);
          --boxel-dropdown-hover-color: var(--hover, var(--boxel-100));
          --boxel-dropdown-highlight-color: var(--hover, var(--boxel-100));
        }
        /* loading affix — the one state the engine cannot express without
           being handed a promise for @options (which strands its `loading`
           flag; see the header note) */
        .pretui-picker-busy {
          position: absolute;
          top: 0;
          right: 8px;
          height: var(--control-h, 28px);
          display: inline-flex;
          align-items: center;
          color: var(--ink-3, var(--boxel-400));
          pointer-events: none;
        }
        /* screen-reader-only; never display:none — a hidden region never speaks */
        .pretui-picker-live {
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
      /* Unlayered: BoxelMultiSelect's power-select's rules are unlayered, and unlayered CSS beats any
         layer, so these overrides only win from outside one. */
      /* the trigger — Pretui field face; grows with wrapped pills */
      .pretui-lookup :deep(.pretui-pickertrigger.ember-power-select-trigger) {
        display: flex;
        align-items: center;
        min-height: var(--control-h, 28px);
        padding: 2px 26px 2px 4px;
        border: 0;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        color: var(--foreground);
        width: 100%;
        overflow: visible;
      }
      /* Ring rides box-shadow so it costs no layout; the transparent outline
         beside it is dead weight in normal rendering and the only thing that
         survives forced-colors mode, where box-shadow is not painted. */
      .pretui-lookup
        :deep(.pretui-pickertrigger.ember-power-select-trigger[aria-expanded='true']),
      .pretui-lookup
        :deep(.pretui-pickertrigger.ember-power-select-trigger:focus-within) {
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--primary),
          var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-lookup[data-invalid]
        :deep(.pretui-pickertrigger.ember-power-select-trigger) {
        box-shadow: 0 0 0 1px var(--destructive);
      }
      .pretui-lookup[data-disabled]
        :deep(.pretui-pickertrigger.ember-power-select-trigger) {
        opacity: 0.45;
        cursor: default;
      }
      .pretui-lookup :deep(ul.ember-power-select-multiple-options) {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px;
        list-style: none;
        margin: 0;
        padding: 0;
        width: 100%;
        min-width: 0;
      }
      /* selected pill — the RecordPill capsule dress, applied to the
         engine's own <li> so removal stays the engine's job */
      .pretui-lookup :deep(li.ember-power-select-multiple-option) {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin: 0;
        min-height: 22px;
        padding: 1px 5px 1px 4px;
        border: 0;
        border-radius: 11px;
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border)
        );
        color: var(--foreground);
        font-size: var(--text-ui-sm, 11.5px);
        max-width: 100%;
      }
      .pretui-lookup :deep(.ember-power-select-multiple-remove-btn) {
        order: 2;
        display: inline-grid;
        place-content: center;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        color: var(--ink-3, var(--boxel-400));
        cursor: pointer;
        opacity: 1;
        font-size: 12px;
        line-height: 1;
      }
      .pretui-lookup :deep(.ember-power-select-multiple-remove-btn:hover) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      /* the combobox input itself — transparent inside the field face */
      .pretui-lookup :deep(li.ember-power-select-trigger-multiple-input-container) {
        flex: 1 1 6ch;
        min-width: 6ch;
        margin: 0;
      }
      .pretui-lookup :deep(input.ember-power-select-trigger-multiple-input) {
        width: 100%;
        height: 24px;
        margin: 0;
        padding: 0 5px;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
      }
      .pretui-lookup :deep(input.ember-power-select-trigger-multiple-input:focus) {
        outline: none;
      }
      .pretui-lookup
        :deep(input.ember-power-select-trigger-multiple-input::placeholder) {
        color: var(--ink-3, var(--boxel-400));
      }
      /* dropdown — the kit's popover look, identical to Select's */
      .pretui-lookup
        :deep(.pretui-picker-dropdown.ember-power-select-dropdown) {
        background: var(--popover);
        border: 0;
        border-radius: 10px;
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.16)
        );
        overflow: hidden;
      }
      .pretui-lookup
        :deep(.pretui-picker-dropdown.ember-basic-dropdown-content--above) {
        margin-bottom: 4px;
      }
      .pretui-lookup :deep(.pretui-picker-dropdown ul) {
        padding: 4px;
        gap: 1px;
        max-height: var(--pretui-lookup-max-height, 15rem);
      }
      .pretui-lookup :deep(.pretui-picker-dropdown li.ember-power-select-option) {
        min-height: 30px;
        margin: 0;
        padding: 4px 8px;
        align-items: center;
        border-radius: var(--radius-chip, 6px);
        background: transparent;
        color: var(--foreground);
        transition: none;
      }
      .pretui-lookup
        :deep(.pretui-picker-dropdown li.ember-power-select-option--highlighted),
      .pretui-lookup
        :deep(.pretui-picker-dropdown li.ember-power-select-option:hover) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      /* Law 2: one hue in — the selected row's fill derives from the accent */
      .pretui-lookup
        :deep(.pretui-picker-dropdown li.ember-power-select-option[aria-selected='true']) {
        background: color-mix(
          in oklch,
          var(--primary) 10%,
          var(--popover)
        );
      }
      .pretui-lookup
        :deep(.pretui-picker-dropdown li.ember-power-select-option[aria-selected='true'].ember-power-select-option--highlighted) {
        background: color-mix(
          in oklch,
          var(--primary) 16%,
          var(--popover)
        );
      }
      .pretui-lookup
        :deep(.pretui-picker-dropdown .ember-power-select-option--no-matches-message) {
        min-height: 30px;
        display: flex;
        align-items: center;
        padding: 0 8px;
        color: var(--ink-3, var(--boxel-400));
        font-style: normal;
        font-size: var(--text-ui-md, 12.5px);
        text-align: left;
      }
    </style>
  </template>
}
