// Pretui — RadioGroup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { RadioGroup } from './radio-group';

const BREAKFAST_OPTIONS = [
  { value: 'eggs', label: 'Eggs' },
  { value: 'tofu', label: 'Tofu' },
  { value: 'strawberry', label: 'Strawberry' },
];
const BREAKFAST_VALUES = BREAKFAST_OPTIONS.map((o) => o.value);
// ── RadioGroup ← radio-input/usage.gts ───────────────────────────────────
// Dropped knobs: @groupDescription (no group-label arg — pair with Field),
// @name (generated internally per group), @hideRadio / @hideBorder (no
// borderless/pill presentation — use SegmentedControl for that), @spacing /
// @orientation (fixed vertical stack), item yield block (options render
// their labels directly), @variant and @radioBackgroundColor /
// @radioBorderColor / @radioHighlightColor (theme tokens own the palette).
export class RadioGroupUsage extends Component {
  breakfastOptions = BREAKFAST_OPTIONS;
  breakfastValues = BREAKFAST_VALUES;
  @tracked value = 'eggs';
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = ['@options={{this.items}}', `@value='${this.value}'`];
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<RadioGroup ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='RadioGroup'
      @description='Radio input'
      @source={{this.usage}}
    >
      <:example>
        <RadioGroup
          @options={{this.breakfastOptions}}
          @value={{this.value}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description="Items which will be represented by radio buttons. Each should have a unique 'value' attribute; per-option disabled via option.disabled."
          @value={{this.breakfastOptions}}
        />
        <Args.String
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @options={{this.breakfastValues}}
          @description="The id of the currently checked/selected item — boxel-ui's @checkedId."
          @onInput={{this.setValue}}
        />
        <Args.Bool
          @name='disabled'
          @optional={{true}}
          @defaultValue='false'
          @value={{this.disabled}}
          @description='Whether selection is disabled'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description="Receives the selected option's value as a string."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RADIO_GROUP: Record<string, unknown> = {
  RadioGroup: RadioGroupUsage,
};
