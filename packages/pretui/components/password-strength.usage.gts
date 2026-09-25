// Pretui — PasswordStrength usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { PasswordStrength } from './password-strength';

class PasswordStrengthUsage extends Component {
  @tracked score = 2;
  suggestions = ['Use four or more unrelated words.', 'Avoid supplier names and lot numbers.'];
  setScore = (score: number | null) => (this.score = score ?? 0);
  <template>
    <FreestyleUsage
      @name='PasswordStrength'
      @description='An advisory meter over an external estimator result. It reports settled strength in text and never gates submission.'
      @source='<PasswordStrength @score="2" @warning="Predictable phrase" … />'
    >
      <:example>
        <PasswordStrength @score={{this.score}} @warning='Predictable phrase' @suggestions={{this.suggestions}} @crackTime='3 hours' @hideWhenEmpty={{false}} />
      </:example>
      <:api as |Args|>
        <Args.Number @name='score' @value={{this.score}} @min={{0}} @max={{4}} @step={{1}} @onInput={{this.setScore}} />
        <Args.String @name='warning' @value='Predictable phrase' />
        <Args.Object @name='suggestions' @value={{this.suggestions}} />
        <Args.String @name='crackTime' @value='3 hours' />
        <Args.Bool @name='busy' @defaultValue={{false}} />
        <Args.Bool @name='hideWhenEmpty' @defaultValue={{true}} />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_PASSWORD_STRENGTH: Record<string, unknown> = {
  PasswordStrength: PasswordStrengthUsage,
};
