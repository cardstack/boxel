// Pretui — Stepper usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Stepper } from './stepper';

// ── Stepper — fresh (no boxel-ui counterpart) ────────────────────────────
// The property-panel number control: −/+ buttons flanking a centered
// number field on one hairline. Buttons disable at the bounds; typed
// values clamp on commit (change event — blur / Enter / native spinners).
class StepperUsage extends Component {
  @tracked value = 3;
  @tracked min = 0;
  @tracked max = 10;
  @tracked step = 1;
  @tracked disabled = false;
  setValue = (v: number) => (this.value = v);
  setMin = (v: number | null) => (this.min = v ?? 0);
  setMax = (v: number | null) => (this.max = v ?? 10);
  setStep = (v: number | null) => (this.step = v ?? 1);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [
      `@value={{${this.value}}}`,
      `@min={{${this.min}}}`,
      `@max={{${this.max}}}`,
    ];
    if (this.step !== 1) bits.push(`@step={{${this.step}}}`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<Stepper ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Stepper'
      @description='Number input flanked by decrement/increment buttons — the property-panel number control. Values clamp at the bounds and the flanking buttons disable when the value sits on them.'
      @source={{this.usage}}
    >
      <:example>
        <Stepper
          @value={{this.value}}
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @description='Controlled value — omit and seed @defaultValue for uncontrolled use (kit contract: args.value ?? internal).'
          @onInput={{this.setValue}}
        />
        <Args.Number
          @name='min'
          @value={{this.min}}
          @description='Lower bound — the − button disables here.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @description='Upper bound — the + button disables here.'
          @onInput={{this.setMax}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Increment applied by the flanking buttons and native spinners.'
          @onInput={{this.setStep}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Number
          @name='defaultValue'
          @description='Uncontrolled seed for the internal value.'
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the clamped value as a number.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_STEPPER: Record<string, unknown> = {
  Stepper: StepperUsage,
};
