// Pretui — ResultCard usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { ResultCard } from './result-card';

class ResultCardUsage extends Component {
  lines = ['3 records updated', 'No validation errors', 'Receipt run_8F3C'];
  <template>
    <FreestyleUsage
      @name='ResultCard'
      @description='A human-readable receipt for agent output. The result is card-shaped and names both outcome and evidence.'
      @source='ResultCard usage'
    >
      <:example>
        <ResultCard @eyebrow='Tea lots' @title='Import complete' @lines={{this.lines}} />
      </:example>
      <:api as |Args|>
        <Args.String @name='title' @value='Import complete' />
        <Args.Object @name='lines' @value={{this.lines}} />
        <Args.String @name='eyebrow' @value='Tea lots' />
        <Args.Action @name='onMenu' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RESULT_CARD: Record<string, unknown> = {
  ResultCard: ResultCardUsage,
};
