// Pretui — FilterChips usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FilterChips } from './filter-chips';

const TAG_OPTIONS = [
  { value: 'javascript', label: 'JavaScript', count: 12, hue: 'var(--chart-1)' },
  { value: 'typescript', label: 'TypeScript', count: 8, hue: 'var(--chart-2)' },
  { value: 'react', label: 'React', count: 5, hue: 'var(--chart-3)' },
  { value: 'vue', label: 'Vue', count: 3, hue: 'var(--chart-4)' },
  { value: 'angular', label: 'Angular', count: 2 },
  { value: 'ember', label: 'Ember', count: 7 },
];
const TAG_VALUES = TAG_OPTIONS.map((o) => o.value);
// ── FilterChips ← tag-list/usage.gts ─────────────────────────────────────
// Dropped knobs: tag-list-* css vars (theme tokens own the palette). New
// args shown in the data: option.count and option.hue.
export class FilterChipsUsage extends Component {
  tagOptions = TAG_OPTIONS;
  tagValues = TAG_VALUES;
  @tracked value = 'javascript';
  @tracked multiple = false;
  @tracked values: string[] = ['javascript'];
  setValue = (v: string) => (this.value = v);
  setValues = (v: string[]) => (this.values = v);
  setMultiple = (v: boolean) => (this.multiple = v);
  get usage() {
    return this.multiple
      ? `<FilterChips @options={{this.tags}} @multiple={{true}} @values={{this.values}} @onValuesChange={{this.setValues}} @label='Filter by tag' />`
      : `<FilterChips @options={{this.tags}} @value='${this.value}' @onValueChange={{this.setValue}} @label='Filter by tag' />`;
  }
  <template>
    <FreestyleUsage
      @name='FilterChips'
      @description='A row of selectable filter chips. Single-select is a radiogroup over native radios — one tab stop, arrows to move; multi-select is a group of native checkboxes, one tab stop each. Both are the correct ARIA for what they do, and neither is a tablist: a filter row picks a value, it does not swap a panel. The count slot is reserved whether or not the number has arrived, so a row does not re-flow as queries resolve.'
      @source={{this.usage}}
    >
      <:example>
        <FilterChips
          @options={{this.tagOptions}}
          @label='Filter by tag'
          @multiple={{this.multiple}}
          @value={{this.value}}
          @values={{this.values}}
          @onValueChange={{this.setValue}}
          @onValuesChange={{this.setValues}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='Array of {value, label} plus optional count and hue per chip.'
          @value={{this.tagOptions}}
        />
        <Args.Bool
          @name='multiple'
          @value={{this.multiple}}
          @description='Switch the chips from radios to checkboxes, and the row from radiogroup to group. Filter rows are multi-select far more often than not.'
          @onInput={{this.setMultiple}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @options={{this.tagValues}}
          @description='Value of the active chip in single-select mode.'
          @onInput={{this.setValue}}
        />
        <Args.Array
          @name='values'
          @value={{this.values}}
          @description='Selected values in multi-select mode; pairs with onValuesChange.'
          @onInput={{this.setValues}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the row. A chip row rarely sits under a visible heading, so this is worth passing.'
        />
        <Args.Bool
          @name='reserveCounts'
          @description='Force the count slot on every chip even before any count arrives. Defaults on as soon as one option declares a count.'
        />
        <Args.Number
          @name='countDigits'
          @description='Width of that reserved slot, in digits (default 2).'
        />
        <Args.Action
          @name='onValueChange'
          @description='Fires with the picked value string in single-select mode.'
        />
        <Args.Action
          @name='onValuesChange'
          @description='Fires with the whole next array in multi-select mode.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FILTER_CHIPS: Record<string, unknown> = {
  FilterChips: FilterChipsUsage,
};
