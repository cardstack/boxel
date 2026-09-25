// Pretui — Input usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Input } from './input';
import { Field } from './field';

const INPUT_TYPES = [
  'text',
  'email',
  'password',
  'number',
  'search',
  'url',
  'date',
];
// ── Input ← input/usage.gts ──────────────────────────────────────────────
// Retrofit ON BoxelInput: the message rows now belong to the component
// itself (@helperText / @errorMessage / @required / @optional are boxel
// machinery surfaced as Pretui args); the wrapping Field still owns the
// label. Dropped knobs: @readonly / @min / @max (native attrs — splat
// them), @bottomTreatment (single rounded shape), @size (single 28px
// control height), @onKeyPress / @onFocus / @onBlur (use native event
// splatting), textarea type (separate Textarea component), checkbox type
// (separate Checkbox component).
export class InputUsage extends Component {
  typeOptions = INPUT_TYPES;
  @tracked value = '';
  @tracked type = 'text';
  @tracked placeholder = 'Please enter';
  @tracked invalid = false;
  @tracked disabled = false;
  @tracked label = 'Full name';
  @tracked helperText = '';
  @tracked errorMessage = 'This value is invalid.';
  @tracked required = false;
  @tracked optionalArg = false;
  setValue = (v: string) => (this.value = v);
  setType = (v: string) => (this.type = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setInvalid = (v: boolean) => (this.invalid = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setLabel = (v: string) => (this.label = v);
  setHelperText = (v: string) => (this.helperText = v);
  setErrorMessage = (v: string) => (this.errorMessage = v);
  setRequired = (v: boolean) => (this.required = v);
  setOptionalArg = (v: boolean) => (this.optionalArg = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.type !== 'text') bits.push(`@type='${this.type}'`);
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.invalid) bits.push('@invalid={{true}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onInput={{this.setValue}}');
    return `<Input ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Input'
      @description='Form text input field riding boxel-ui BoxelInput — validation states, error/helper message rows, optional indicator — in the Pretui control dress. Supports text, email, password, number, search, url, and date types.'
      @source={{this.usage}}
    >
      <:example>
        <Field @label={{this.label}} as |controlId|>
          <Input
            @controlId={{controlId}}
            @value={{this.value}}
            @type={{this.type}}
            @placeholder={{this.placeholder}}
            @invalid={{this.invalid}}
            @disabled={{this.disabled}}
            @helperText={{this.helperText}}
            @errorMessage={{this.errorMessage}}
            @required={{this.required}}
            @optional={{this.optionalArg}}
            @onInput={{this.setValue}}
          />
        </Field>
        <p class='pretui-demo-readout' data-test-input-readout>
          type = {{this.type}} · value = “{{this.value}}”
        </p>
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='controlId'
          @description="The input's id for label wiring — supplied by the wrapping Field's yielded controlId; replaces boxel-ui's @id."
        />
        <Args.String
          @name='type'
          @value={{this.type}}
          @options={{this.typeOptions}}
          @defaultValue='text'
          @description='Native input type — pick number or password to see the control change shape.'
          @onInput={{this.setType}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.Bool
          @name='invalid'
          @value={{this.invalid}}
          @description="The validation state of the input — boxel-ui's @state enum, now a boolean."
          @onInput={{this.setInvalid}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='errorMessage'
          @value={{this.errorMessage}}
          @description="Error row under the control — boxel-ui's @errorMessage; renders only while @invalid."
          @onInput={{this.setErrorMessage}}
        />
        <Args.String
          @name='helperText'
          @value={{this.helperText}}
          @description="Helper row under the control — boxel-ui's @helperText."
          @onInput={{this.setHelperText}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @description='Native required; also suppresses the optional indicator.'
          @onInput={{this.setRequired}}
        />
        <Args.Bool
          @name='optional'
          @value={{this.optionalArg}}
          @description="Renders boxel-ui's 'Optional' indicator above the control."
          @onInput={{this.setOptionalArg}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Placeholder text'
          @onInput={{this.setPlaceholder}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @description='Field label — set on the wrapping Field, not on Input.'
          @onInput={{this.setLabel}}
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string'
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

export const DEMOS_INPUT: Record<string, unknown> = {
  Input: InputUsage,
};
