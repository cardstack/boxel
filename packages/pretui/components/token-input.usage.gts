// Pretui — TokenInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TokenInput } from './token-input';

// ── TokenInput ───────────────────────────────────────────────────────────
class TokenInputUsage extends Component {
  @tracked values: string[] = [
    'Velvet',
    'Brushed brass metal',
    'Patterned tile',
    'Ribbed glass',
  ];
  @tracked placeholder = 'Add texture…';
  @tracked labelText = 'Textures';
  @tracked max: number | null = 8;
  @tracked allowDuplicates = false;
  @tracked disabled = false;
  @tracked mixed = false;

  setValues = (v: string[]) => (this.values = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setLabel = (v: string) => (this.labelText = v);
  setMax = (v: number) => (this.max = v);
  setAllowDuplicates = (v: boolean) => (this.allowDuplicates = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setMixed = (v: boolean) => (this.mixed = v);

  get maxVal() {
    return this.max === null ? undefined : this.max;
  }
  get readout() {
    return this.values.length === 0 ? '(empty)' : this.values.join(' · ');
  }
  get usage() {
    return (
      "<TokenInput @label='" +
      this.labelText +
      "' @value={{this.values}} @onChange={{this.setValues}} />"
    );
  }
  <template>
    <FreestyleUsage
      @name='TokenInput'
      @description='The array-of-values row: an open-ended set of short strings as removable chips. Type and press Enter, type a comma, or paste a comma-separated run to add; Backspace in an empty field removes the last member; every chip carries a named remove button. Not a MultiSelect — the vocabulary is not fixed — and not Reorder, which reorders a list that already exists. Neither figui3 nor the kit had one, yet a property panel is full of them: mood keywords, materials, props, practical lights.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-token-demo'>
          <TokenInput
            @label={{this.labelText}}
            @value={{this.values}}
            @placeholder={{this.placeholder}}
            @max={{this.maxVal}}
            @allowDuplicates={{this.allowDuplicates}}
            @disabled={{this.disabled}}
            @mixed={{this.mixed}}
            @onChange={{this.setValues}}
          />
          <p class='pretui-demo-readout' data-test-token-readout>
            {{this.readout}}
          </p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.labelText}}
          @description='Accessible name for the entry field. Standalone it becomes a visually-hidden <label for>; inside a PropertyRow, pass the yielded controlId instead and the row owns the visible label — never both.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Entry-field placeholder. Replaced by “Mixed” under @mixed and by “List is full” at @max.'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @min={{1}}
          @max={{12}}
          @description='Cap. The entry field goes readonly + aria-disabled at the cap rather than disappearing, so a keyboard reader can still find the row and hear why nothing is happening. A count rides at the end of the field.'
          @onInput={{this.setMax}}
        />
        <Args.Bool
          @name='allowDuplicates'
          @defaultValue={{false}}
          @value={{this.allowDuplicates}}
          @description='Off by default — every one of these lists is a set in disguise, and “Velvet” twice is a typo. A rejected add SAYS why in the live region instead of doing nothing, which is what makes a silent rejection feel like a broken key.'
          @onInput={{this.setAllowDuplicates}}
        />
        <Args.Bool
          @name='mixed'
          @defaultValue={{false}}
          @value={{this.mixed}}
          @description='Multi-selection whose lists differ: the chips are withheld (there is no one list to show) and the word “Mixed” stands in.'
          @onInput={{this.setMixed}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Array
          @name='value'
          @description='CONTROLLED list; omit and seed @defaultValue for uncontrolled use.'
        />
        <Args.String
          @name='controlId'
          @description='id for the entry field, so a PropertyRow label points at it.'
        />
        <Args.Action
          @name='onChange'
          @description='Every accepted add and every remove. Receives a NEW array — the argument is never mutated.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-token-demo {
        max-width: 320px;
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TOKEN_INPUT: Record<string, unknown> = {
  TokenInput: TokenInputUsage,
};
