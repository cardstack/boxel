// Pretui — Select usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Select } from './select';

const COUNTRY_NAMES = [
  'United States',
  'Spain',
  'Portugal',
  'Russia',
  'Latvia',
  'Brazil',
  'United Kingdom',
  'Japan',
];
const COUNTRY_OPTIONS = COUNTRY_NAMES.map((c) => ({ value: c, label: c }));
// ── Select ← select/usage.gts ────────────────────────────────────────────
// Dropped knobs: @variant (tone/appearance theming not on Select yet),
// @verticalPosition (listbox always opens below), @renderInPlace (the
// listbox always renders in the wormhole, so nothing clips it),
// @matchTriggerWidth (listbox always matches),
// @searchField (search filters by label), item yield block (options are
// {value, label} data, rendered by the component).
// The dropdown renders in the wormhole, so an overflow-hidden ancestor does
// not clip it; its colors come from the theme contract.
export class SelectUsage extends Component {
  countryNames = COUNTRY_NAMES;
  countryOptions = COUNTRY_OPTIONS;
  @tracked value = '';
  @tracked placeholder = 'Select Item';
  @tracked disabled = false;
  @tracked searchEnabled = false;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setSearchEnabled = (v: boolean) => (this.searchEnabled = v);
  get usage() {
    let bits = ['@options={{this.countries}}', "@label='Country'"];
    if (this.value) bits.push(`@value='${this.value}'`);
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.searchEnabled) bits.push('@searchEnabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<Select ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Select'
      @description='Choose one value from a known list.'
      @source={{this.usage}}
    >
      <:example>
        <Select
          @options={{this.countryOptions}}
          @label='Country'
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @searchEnabled={{this.searchEnabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description='The options to list, as {value, label} pairs.'
          @value={{this.countryOptions}}
        />
        <Args.Action
          @name='onValueChange'
          @description="Receives the chosen option's value as a string."
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @options={{this.countryNames}}
          @description="The selected option's value."
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Text shown when nothing is selected.'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='When true, the control cannot be used.'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='searchEnabled'
          @defaultValue={{false}}
          @value={{this.searchEnabled}}
          @description='Adds a search box above the list; it takes focus when the list opens.'
          @onInput={{this.setSearchEnabled}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SELECT: Record<string, unknown> = {
  Select: SelectUsage,
};
