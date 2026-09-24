// Pretui — Delta usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from '../freestyle';
import { Delta } from '../ink';

class DeltaUsage extends Component {
  values = [12, -4, 0];
  <template>
    <FreestyleUsage
      @name='Delta'
      @description='Signed change as bare mono text. Sign is always present in text, so success and destructive hues never carry meaning alone.'
      @source='<Delta @value={{12}} />'
    >
      <:example>
        <div class='foundation-row'>
          {{#each this.values as |value|}}<Delta @value={{value}} />{{/each}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='sample values' @value={{this.values}} />
        <Args.Base @name='value' @description='Number or numeric string. Positive values receive a leading plus.' />
        <Args.Action @name='format' @description='Optional number-to-string formatter.' />
      </:api>
    </FreestyleUsage>
    <style scoped>.foundation-row { display: flex; gap: var(--space-5, 14px); align-items: baseline; }</style>
  </template>
}

export const DEMOS_DELTA: Record<string, unknown> = {
  Delta: DeltaUsage,
};
