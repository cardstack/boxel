// Pretui — Token usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';

class TokenUsage extends Component {
  values = ['records@2.4.0', 'LOT-B-103', 'ctse/pretui'];
  <template>
    <FreestyleUsage
      @name='Token'
      @description='Machine values set as jewelry: compact mono pills that remain inline in prose and trim their margin when flush-set in a cell.'
      @source="<Token @value='records@2.4.0' />"
    >
      <:example>
        <p class='foundation-prose'>Imported <Token @value='records@2.4.0' /> for lot <Token @value='LOT-B-103' /> in <Token @value='ctse/pretui' />.</p>
      </:example>
      <:api as |Args|>
        <Args.Object @name='sample values' @value={{this.values}} />
        <Args.String @name='value' @value='records@2.4.0' />
        <Args.String @name='hue' @description='Validated CSS colour override; normally omitted.' />
        <Args.Yield @name='default' @description='Alternative to value for inline content.' />
      </:api>
    </FreestyleUsage>
    <style scoped>.foundation-prose { margin: 0; color: var(--foreground); }</style>
  </template>
}

export const DEMOS_TOKEN: Record<string, unknown> = {
  Token: TokenUsage,
};
