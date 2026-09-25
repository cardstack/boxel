// Pretui — NumberInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { NumberInput } from './number-input';

function isNullVal(v: number | null): boolean {
  return v === null;
}

// ── NumberInput — typed-input split, fresh page ──────────────────────────
// Type-specific knobs: min / max / step / precision. Values clamp + round
// on commit (blur / Enter / spinners); the readout shows what @onInput
// received (number | null).
class NumberInputUsage extends Component {
  @tracked emitted: number | null = null;
  @tracked min = 0;
  @tracked max = 100;
  @tracked step = 1;
  @tracked precision = 0;
  @tracked placeholder = '0';
  @tracked disabled = false;
  @tracked required = false;
  setEmitted = (v: number | null) => (this.emitted = v);
  setMin = (v: number | null) => (this.min = v ?? 0);
  setMax = (v: number | null) => (this.max = v ?? 100);
  setStep = (v: number | null) => (this.step = v ?? 1);
  setPrecision = (v: number | null) => (this.precision = v ?? 0);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [
      `@min={{${this.min}}}`,
      `@max={{${this.max}}}`,
      `@step={{${this.step}}}`,
    ];
    if (this.precision) bits.push(`@precision={{${this.precision}}}`);
    bits.push('@onInput={{this.setValue}}');
    return `<NumberInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='NumberInput'
      @description='Numeric entry riding boxel-ui BoxelInput (@type=number): native spinners and keyboard steps via @min/@max/@step, plus clamp-and-round to @precision decimals on commit — clamping never fights mid-keystroke.'
      @source={{this.usage}}
    >
      <:example>
        {{! uncontrolled on purpose: feeding every parsed keystroke back
            into a controlled number @value would fight partial entries
            like '3.' — the readout below proves the @onInput loop instead }}
        <NumberInput
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @precision={{this.precision}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setEmitted}}
        />
        <p class='pretui-demo-readout' data-test-number-readout>
          onInput received:
          {{if (isNullVal this.emitted) 'null' this.emitted}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='min'
          @value={{this.min}}
          @description='Lower bound — commits clamp here; native spinners stop here.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @description='Upper bound.'
          @onInput={{this.setMax}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Spinner / arrow-key increment.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{0}}
          @value={{this.precision}}
          @description='Decimal places applied on commit (0 = integers). Try 2 and type 3.14159.'
          @onInput={{this.setPrecision}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives number | null — null while the field is empty.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_NUMBER_INPUT: Record<string, unknown> = {
  NumberInput: NumberInputUsage,
};
