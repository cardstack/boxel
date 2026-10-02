// Pretui — QueuedMessage usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { QueuedMessage } from './queued-message';
import { DemoReceipt, DemoStack } from '../demo-foundations-more';

class QueuedMessageUsage extends Component {
  @tracked receipt = 'Waiting for the next checkpoint';
  send = () => (this.receipt = 'Interrupt requested');
  <template>
    <FreestyleUsage @name='QueuedMessage' @description='A queued instruction that names its delivery semantics instead of hiding them in an icon or colour.' @source='<QueuedMessage @text="Also check the reserve price" @mode="steer" … />' @viewportMode='wide'>
      <:example><DemoStack><QueuedMessage @text='Also check the reserve price' @mode='steer' @onSendNow={{this.send}} /><DemoReceipt>{{this.receipt}}</DemoReceipt></DemoStack></:example>
      <:api as |Args|><Args.String @name='text' @value='Also check the reserve price' /><Args.String @name='mode' @value='steer' /><Args.Action @name='onSendNow' /><Args.Action @name='onEdit' /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_QUEUED_MESSAGE: Record<string, unknown> = {
  QueuedMessage: QueuedMessageUsage,
};
