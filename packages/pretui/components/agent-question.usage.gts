// Pretui — AgentQuestion usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AgentQuestion } from './agent-question';
import { DemoReceipt, DemoStack } from '../demo-foundations-more';

class AgentQuestionUsage extends Component {
  options = ['Keep the current title', 'Use the supplier title', 'Merge both'];
  @tracked answer = 'No answer yet';
  answered = (value: string) => (this.answer = value);
  <template>
    <FreestyleUsage @name='AgentQuestion' @description='A question from an agent with finite options and a free-answer escape hatch. Once answered it settles into a receipt.' @source='<AgentQuestion @question="Which title should win?" … />'>
      <:example><DemoStack><AgentQuestion @question='Which title should win?' @options={{this.options}} @onAnswer={{this.answered}} /><DemoReceipt>{{this.answer}}</DemoReceipt></DemoStack></:example>
      <:api as |Args|><Args.String @name='question' @value='Which title should win?' /><Args.Object @name='options' @value={{this.options}} /><Args.String @name='answered' /><Args.Action @name='onAnswer' /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AGENT_QUESTION: Record<string, unknown> = {
  AgentQuestion: AgentQuestionUsage,
};
