// Pretui — CollapsedTurn usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CollapsedTurn } from './collapsed-turn';
import { DemoReceipt, DemoStack } from '../demo-foundations-more';

class CollapsedTurnUsage extends Component {
  @tracked receipt = 'Collapsed';
  expand = () => (this.receipt = 'Expand requested');
  <template>
    <FreestyleUsage @name='CollapsedTurn' @description='Settled agent history reduced to a quiet count receipt. The whole capsule remains an ordinary button.' @source='<CollapsedTurn @summary="Read 8 cards · changed 3" />'>
      <:example><DemoStack><CollapsedTurn @summary='Read 8 cards · changed 3' @onExpand={{this.expand}} /><DemoReceipt>{{this.receipt}}</DemoReceipt></DemoStack></:example>
      <:api as |Args|><Args.String @name='summary' @value='Read 8 cards · changed 3' /><Args.Action @name='onExpand' /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COLLAPSED_TURN: Record<string, unknown> = {
  CollapsedTurn: CollapsedTurnUsage,
};
