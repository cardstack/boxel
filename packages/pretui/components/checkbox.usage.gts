// Pretui — Checkbox usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Checkbox } from './checkbox';

export class CheckboxUsage extends Component {
  @tracked checked = true;
  setChecked = (value: boolean) => (this.checked = value);
  <template>
    <FreestyleUsage
      @name='Checkbox'
      @description='A native binary choice in Pretui cloth. The visible label and checked state travel together; disabled remains a legible state, never a dim surface.'
      @source='<Checkbox @label="Include tasting notes" … />'
    >
      <:example>
        <Checkbox @label='Include tasting notes' @checked={{this.checked}} @onCheckedChange={{this.setChecked}} />
      </:example>
      <:api as |Args|>
        <Args.Bool @name='checked' @value={{this.checked}} @onInput={{this.setChecked}} />
        <Args.String @name='label' @value='Include tasting notes' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
        <Args.Action @name='onCheckedChange' @description='Receives the next boolean value.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_CHECKBOX: Record<string, unknown> = {
  Checkbox: CheckboxUsage,
};
