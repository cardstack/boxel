// Pretui — Transmute usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Transmute } from './transmute';
import { DemoStack } from '../demo-foundations-more';

const TransmuteUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='Transmute' @description='Three truthful cuts of one operation: verb, human label and machine call. Hover promotes one tier without changing the verb.' @source='<Transmute @verb="READ" @label="Auction lot" @call="getCard(B-103)" />' @viewportMode='wide'>
      <:example><DemoStack><Transmute @verb='READ' @label='Auction lot' @call='getCard(B-103)' @tier='t0' /><Transmute @verb='WRITE' @label='Approval status' @call='patchCard(B-103)' @tier='t1' /><Transmute @verb='QUERY' @label='Spring lots' @call='searchCards({ season: 2026 })' @tier='t2' /></DemoStack></:example>
      <:api as |Args|><Args.String @name='verb' @value='READ' /><Args.String @name='label' @value='Auction lot' /><Args.String @name='call' @value='getCard(B-103)' /><Args.String @name='tier' @value='t1' /></:api>
    </FreestyleUsage>
  </template>;

export const DEMOS_TRANSMUTE: Record<string, unknown> = {
  Transmute: TransmuteUsage,
};
