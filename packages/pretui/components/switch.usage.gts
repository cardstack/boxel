// Pretui — Switch usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Switch } from './switch';

// ── Switch ← switch/usage.gts ────────────────────────────────────────────
// Dropped knobs: @label (no label arg on the bare control — pair with Field
// or your own <label>; boxel-ui rendered it inline).
export class SwitchUsage extends Component {
  @tracked checkedVal = false;
  @tracked disabled = false;
  setChecked = (v: boolean) => (this.checkedVal = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [`@checked={{${this.checkedVal}}}`];
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onCheckedChange={{this.setChecked}}');
    return `<Switch ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Switch'
      @description='A switch is a component that allows the user to switch a setting on or off.'
      @source={{this.usage}}
    >
      <:example>
        <Switch
          @checked={{this.checkedVal}}
          @disabled={{this.disabled}}
          @onCheckedChange={{this.setChecked}}
        />
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='checked'
          @defaultValue={{false}}
          @value={{this.checkedVal}}
          @description="Controlled on/off state — boxel-ui's @isEnabled."
          @onInput={{this.setChecked}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onCheckedChange'
          @description="Receives the next checked state as a boolean — boxel-ui's @onChange."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SWITCH: Record<string, unknown> = {
  Switch: SwitchUsage,
};
