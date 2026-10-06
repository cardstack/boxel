// Pretui — Lookup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import {
  PEOPLE,
  SUPPLIERS,
  pick,
  seedFrom,
} from '../examples';
import { Lookup } from './lookup';
import type { PickerRecord } from '../internal/forms-picker';
import { ACCOUNTS } from '../internal/forms-picker-fixtures';

// ── Lookup ← slds lookups/ + combobox/ ───────────────────────────────────
const CONTACTS: PickerRecord[] = PEOPLE.slice(0, 10).map((name, i) => ({
  id: `003R0000${String(i + 21).padStart(2, '0')}`,
  label: name,
  meta: `Contact • ${pick(seedFrom(name), i, SUPPLIERS)}`,
  icon: 'user',
}));

// Dropped SLDS surface (also named in the component's own header): the
// `selectOnly` faux-input single-select, the object-switcher addon and
// advanced-search modal, the `+6 more` selection-group toggle, and every
// `isOpen`/`hasFocus`/`hasInteractions` prop that existed only to freeze the
// React examples into static snapshots.
class LookupUsage extends Component {
  @tracked objectType = 'Accounts';
  @tracked query = '';
  @tracked selected: PickerRecord[] = [ACCOUNTS[0] as PickerRecord];
  @tracked multiple = false;
  @tracked loading = false;
  @tracked disabled = false;
  @tracked placeholder = 'Search accounts…';

  objectTypes = ['Accounts', 'Contacts'];

  get pool(): PickerRecord[] {
    return this.objectType === 'Contacts' ? CONTACTS : ACCOUNTS;
  }
  /**
   * The CALLER owns search. In a real card this is a `searchCards` query
   * behind a debounce; here it is a synchronous filter over the bank so the
   * workbench needs no network and no timers.
   */
  get results(): PickerRecord[] {
    let term = this.query.trim().toLowerCase();
    let base = this.pool;
    let hits = term
      ? base.filter(
          (r) =>
            r.label.toLowerCase().includes(term) ||
            (r.meta ?? '').toLowerCase().includes(term),
        )
      : base;
    return hits.slice(0, 6);
  }
  get selectedIds(): string[] {
    return this.selected.map((r) => r.id);
  }
  get recordNoun() {
    return this.objectType === 'Contacts' ? 'contact' : 'account';
  }
  get label() {
    return this.objectType === 'Contacts' ? 'Search Contacts' : 'Search Accounts';
  }

  setObjectType = (v: string) => {
    this.objectType = v;
    this.selected = [];
    this.query = '';
    this.placeholder = `Search ${v.toLowerCase()}…`;
  };
  setQuery = (v: string) => (this.query = v);
  setSelected = (records: PickerRecord[]) => (this.selected = records);
  setMultiple = (v: boolean) => {
    this.multiple = v;
    if (!v) {
      this.selected = this.selected.slice(0, 1);
    }
  };
  setLoading = (v: boolean) => (this.loading = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setSelectedIds = (ids: string[]) => {
    this.selected = ids
      .map((id) => this.pool.find((r) => r.id === id))
      .filter((r): r is PickerRecord => Boolean(r));
  };

  get usage() {
    let bits = [
      '@records={{this.results}}',
      '@selected={{this.selected}}',
      `@label='${this.label}'`,
      `@recordNoun='${this.recordNoun}'`,
    ];
    if (this.multiple) {
      bits.push('@multiple={{true}}');
    }
    if (this.loading) {
      bits.push('@loading={{true}}');
    }
    if (this.disabled) {
      bits.push('@disabled={{true}}');
    }
    if (this.placeholder) {
      bits.push(`@placeholder='${this.placeholder}'`);
    }
    bits.push('@onSearch={{this.search}}');
    bits.push('@onSelectionChange={{this.setSelected}}');
    return `<Lookup ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='Lookup'
      @description='The record-reference control — a Salesforce lookup field. Type to search, review a results listbox with per-record chrome (icon, primary label, secondary meta line, matched-term highlight), and commit the pick as a removable pill. Reach for it whenever a value points at another record rather than being typed: Account on an Opportunity, Reports To on a Contact, Supplier on a purchase order. The dropdown ENGINE is ember-power-select, reached through boxel-ui BoxelMultiSelectBasic and rendered in place so Pretui tokens reach it — so outside-click dismissal, Escape, focus return, arrow/Enter keyboard, the aria-activedescendant wiring and the result-count live region are all the engine’s, not ours. It owns NO fetching: you supply @records and @loading and debounce inside @onSearch (realm law forbids timers in components). Honest limits: the search text belongs to the engine, so there is no @query arg to control it; filtering is LOCAL over the records you supply, matched against record.search (label + meta + id by default) — put anything a fuzzy server match found into record.search or it will be filtered back out; the listbox reports aria-multiselectable even in single-select; and issue rendering belongs to the surrounding form field, not here.'
      @source={{this.usage}}
    >
      <:example>
        <Lookup
          @records={{this.results}}
          @selected={{this.selected}}
          @multiple={{this.multiple}}
          @loading={{this.loading}}
          @disabled={{this.disabled}}
          @label={{this.label}}
          @recordNoun={{this.recordNoun}}
          @placeholder={{this.placeholder}}
          @onSearch={{this.setQuery}}
          @onSelectionChange={{this.setSelected}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='objectType'
          @value={{this.objectType}}
          @options={{this.objectTypes}}
          @description='DEMO KNOB, not a Lookup arg — swaps the record bank between Accounts and Contacts so you can see the icon/meta channel change.'
          @onInput={{this.setObjectType}}
        />
        <Args.Object
          @name='records'
          @required={{true}}
          @description='Result records to render, already filtered and sorted by the caller: {id, label, meta?, icon?}. Plain values, never card instances.'
          @value={{this.results}}
        />
        <Args.Array
          @name='selected'
          @description='Controlled selection, as records (not ids) so a pill can render after the results list has moved on. Single-select is simply an array of 0 or 1. Edit as comma-separated ids.'
          @value={{this.selectedIds}}
          @onInput={{this.setSelectedIds}}
        />
        <Args.String
          @name='(search text)'
          @value={{this.query}}
          @description='READ-ONLY, and not an arg. ember-power-select owns the search text; there is no supported way to push a value back in, so @query / @defaultQuery were removed in the engine swap. This row mirrors what @onSearch last reported. Type in the example to watch it move.'
          @onInput={{this.setQuery}}
        />
        <Args.Bool
          @name='multiple'
          @defaultValue={{false}}
          @description='Allow more than one record. Single-select replaces on each pick instead of forcing a clear first.'
          @value={{this.multiple}}
          @onInput={{this.setMultiple}}
        />
        <Args.Bool
          @name='loading'
          @defaultValue={{false}}
          @description='Async search in flight — spins the trigger affix and announces “Searching…”. Keep the previous @records in place while it is true; the engine shows its own “No results found” row for an empty list and cannot be told to wait.'
          @value={{this.loading}}
          @onInput={{this.setLoading}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Blocks every interaction.'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Input placeholder.'
          @defaultValue='Search…'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Base
          @name='defaultSelected'
          @type='PickerRecord[]'
          @description='Uncontrolled initial selection. Ignored once @selected is supplied.'
        />
        <Args.Bool
          @name='invalid'
          @defaultValue={{false}}
          @description='Error dress plus aria-invalid. The message itself belongs to the surrounding form field — this control never validates.'
        />
        <Args.Base
          @name='label'
          @type='String'
          @defaultValue='Search {recordNoun}s'
          @description='Accessible name for the combobox input — passed to the engine as @ariaLabel. This is the only naming channel: BoxelMultiSelectBasic does not forward aria-labelledby or aria-describedby, so @labelledBy / @describedBy were removed in the engine swap.'
        />
        <Args.Base
          @name='recordNoun'
          @type='String'
          @defaultValue='record'
          @description="Noun used in the listbox name and every announcement — 'account', 'contact', 'lot'."
        />
        <Args.Action
          @name='onSearch'
          @description='Fires on every keystroke with the current query. Debounce and fetch HERE — the component owns no timers and no fetching.'
        />
        <Args.Action
          @name='onSelectionChange'
          @description='Fires with the FULL selection (PickerRecord[]) after every pick or remove.'
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with true/false when the results panel opens or closes.'
        />
        <Args.Yield
          @name=':option'
          @description='Replaces the default result row. Yields (record, {selected, term}) — the default row is a RecordFace with the matched term marked. :empty and :footer were removed in the engine swap: power-select owns the no-results row, and @afterOptionsComponent takes a component, not a block.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_LOOKUP: Record<string, unknown> = {
  Lookup: LookupUsage,
};
