// Pretui — PhoneInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { PhoneInput } from './phone-input';

// ── PhoneInput ← phone-input/usage.gts ───────────────────────────────────
// Dropped knobs: none upstream — the full set carries over. Same surface
// adaptation as EmailInput: @onChange(value, NormalizePhoneFormatResult,
// ev) splits into @onInput(value) + @onValidation(errorMessage | null).
// @onInput receives boxel's sanitized value: E.164 when valid, trimmed
// digits otherwise.
class PhoneInputUsage extends Component {
  @tracked value = '';
  @tracked lastError: string | null = null;
  @tracked placeholder = '';
  @tracked disabled = false;
  @tracked required = false;
  setValue = (v: string) => (this.value = v);
  setError = (e: string | null) => (this.lastError = e);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.required) bits.push('@required={{true}}');
    bits.push('@onInput={{this.setValue}}', '@onValidation={{this.setError}}');
    return `<PhoneInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='PhoneInput'
      @description="Wraps boxel-ui's PhoneInput — as-you-type formatting, E.164 normalization, and region validation via awesome-phonenumber — re-dressed through the Pretui token channel. Sanitized values arrive via @onInput; the current validation error message (or null) via @onValidation."
      @source={{this.usage}}
    >
      <:example>
        <PhoneInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setValue}}
          @onValidation={{this.setError}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @description='The current value passed to the input'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @defaultValue='Enter phone'
          @value={{this.placeholder}}
          @description='Empty input placeholder'
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
          @description='Empty input counts as invalid once required.'
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the sanitized value as a string: E.164 when valid, trimmed digits otherwise.'
        />
        <Args.Action
          @name='onValidation'
          @description="Receives the current validation error message, or null when valid/empty — boxel-ui's NormalizePhoneFormatResult, collapsed to its error message."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_PHONE_INPUT: Record<string, unknown> = {
  PhoneInput: PhoneInputUsage,
};
