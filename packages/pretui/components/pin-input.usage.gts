// Pretui — PinInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { PinInput } from './composites';

class PinInputUsage extends Component {
  @tracked value = '';
  setValue = (v: string) => (this.value = v);
  <template>
    <FreestyleUsage
      @name='PinInput'
      @description='OtpInput under the Mantine / Chakra name: fixed-length code entry, one character per segment. Reach for this import when a port or an agent already speaks that vocabulary; the component, its contract and its writeup are OtpInput’s.'
      @source="<PinInput @value={{this.value}} @onValueChange={{this.setValue}} />"
    >
      <:example>
        <PinInput
          @value={{this.value}}
          @label='One-time code'
          @onValueChange={{this.setValue}}
        />
        <p class='pretui-demo-readout'>value = “{{this.value}}”</p>
      </:example>
      <:api as |Args|>
        <Args.Number @name='length' @defaultValue={{6}} @description='Segment count; Mantine’s length, shadcn’s maxLength.' />
        <Args.String @name='value' @value={{this.value}} @description='The segments joined into one dense string.' @onInput={{this.setValue}} />
        <Args.String @name='type' @defaultValue='numeric' @description='Allowed character class: numeric, alpha or alphanumeric.' />
        <Args.Bool @name='masked' @defaultValue={{false}} @description='Password dots; Mantine’s mask.' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
        <Args.String @name='label' @defaultValue='One-time code' @description='Group label announced by assistive tech.' />
        <Args.Action @name='onValueChange' @description='Every edit, with the joined string; compare its length to @length for Mantine’s onComplete.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_PIN_INPUT: Record<string, unknown> = {
  PinInput: PinInputUsage,
};
