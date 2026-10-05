// Pretui — MultiSelect usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { MultiSelect } from './multi-select';

const COUNTRY_NAMES = [
  'United States',
  'Spain',
  'Portugal',
  'Russia',
  'Latvia',
  'Brazil',
  'United Kingdom',
];
const COUNTRY_OPTIONS = COUNTRY_NAMES.map((c) => ({ value: c, label: c }));


// ── MultiSelect ← multi-select/usage.gts ─────────────────────────────────
// Dropped knobs: @renderInPlace / @matchTriggerWidth (Popup always renders
// in place and matches the trigger), @searchEnabled / @searchField (no
// search box in wave-0), @closeOnSelect (the listbox always stays open
// across toggles — that's the multi-select semantic), @selectedItemComponent
// and the custom AssigneePill / CheckboxIndicator dropdown components
// (options are {value, label} data, rendered by the component),
// @registerAPI / publicAPI (no power-select escape hatch), the
// boxel-selected-pill-* css vars (chips wear the FilterChips capsule dress
// from theme tokens).
export class MultiSelectUsage extends Component {
  countryOptions = COUNTRY_OPTIONS;
  @tracked values: string[] = ['Spain', 'Portugal'];
  @tracked placeholder = 'Select Items';
  @tracked disabled = false;
  setValues = (v: string[]) => (this.values = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = ['@options={{this.countries}}', '@value={{this.values}}'];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValues}}');
    return `<MultiSelect ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='MultiSelect'
      @description='Dropdown control that lets the user pick multiple values from a list — shows the selected items as removable chips and emits the full selection on every toggle. Built fresh on the Popup primitive; keyboard: arrows move, Enter toggles, Escape closes.'
      @source={{this.usage}}
    >
      <:example>
        <MultiSelect
          @options={{this.countryOptions}}
          @value={{this.values}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValues}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description='An array of items to be listed on the dropdown — {value, label} pairs.'
          @value={{this.countryOptions}}
        />
        <Args.Array
          @name='value'
          @description="Array of selected values — boxel-ui's @selected array of objects, now string values (comma-separate to edit)."
          @value={{this.values}}
          @onInput={{this.setValues}}
        />
        <Args.String
          @name='placeholder'
          @description='Placeholder for trigger component'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='When truthy the component cannot be interacted'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description="Receives the full selection as string[] on every toggle — boxel-ui's @onChange, which received the selected objects."
        />
      </:api>
    </FreestyleUsage>
  </template>
}


export const DEMOS_MULTI_SELECT: Record<string, unknown> = {
  MultiSelect: MultiSelectUsage,
};
