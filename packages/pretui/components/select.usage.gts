// Pretui — Select usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Select } from './select';

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
// ── Select ← select/usage.gts ────────────────────────────────────────────
// Dropped knobs: @variant (tone/appearance theming not on Select yet),
// @verticalPosition (listbox always opens below), @renderInPlace (always
// in place — no portal), @matchTriggerWidth (listbox always matches),
// @searchEnabled / @searchField (keyboard typeahead replaces the search
// box), item yield block (options are {value, label} data, rendered by the
// component).
export class SelectUsage extends Component {
  countryNames = COUNTRY_NAMES;
  countryOptions = COUNTRY_OPTIONS;
  @tracked value = '';
  @tracked placeholder = 'Select Item';
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = ['@options={{this.countries}}'];
    if (this.value) bits.push(`@value='${this.value}'`);
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<Select ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Select'
      @description='Select components allow users to choose from a list of options. They support theme variants and customizable styling with search functionality.'
      @source={{this.usage}}
    >
      <:example>
        <Select
          @options={{this.countryOptions}}
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description='An array of items, to be listed on dropdown — now {value, label} pairs.'
          @value={{this.countryOptions}}
        />
        <Args.Action
          @name='onValueChange'
          @required={{true}}
          @description="Receives the chosen option's value as a string — boxel-ui's @onChange, which received the whole item."
        />
        <Args.String
          @name='value'
          @required={{true}}
          @value={{this.value}}
          @options={{this.countryNames}}
          @description="Selected item — boxel-ui's object @selected, now the selected option's string value."
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Placeholder for trigger component'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='When truthy the component cannot be interacted'
          @onInput={{this.setDisabled}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SELECT: Record<string, unknown> = {
  Select: SelectUsage,
};
