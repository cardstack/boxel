// Pretui — ApprovalFooter usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ApprovalFooter } from './approval-footer';
import { DemoReceipt, DemoStack } from '../demo-foundations-more';

class ApprovalFooterUsage extends Component {
  @tracked receipt = 'Awaiting a decision';
  keep = () => (this.receipt = 'Kept 3 changes');
  revert = () => (this.receipt = 'Reverted 3 changes');
  <template>
    <FreestyleUsage @name='ApprovalFooter' @description='A decision boundary for staged changes. It states the count and keeps destructive intent explicit in button text.' @source='<ApprovalFooter @count={{3}} @onKeep={{this.keep}} … />'>
      <:example><DemoStack><ApprovalFooter @count={{3}} @onKeep={{this.keep}} @onRevert={{this.revert}} /><DemoReceipt>{{this.receipt}}</DemoReceipt></DemoStack></:example>
      <:api as |Args|><Args.Number @name='count' @value={{3}} /><Args.Bool @name='destructive' @defaultValue={{false}} /><Args.Action @name='onKeep' /><Args.Action @name='onRevert' /><Args.Action @name='onAcceptAll' /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_APPROVAL_FOOTER: Record<string, unknown> = {
  ApprovalFooter: ApprovalFooterUsage,
};
