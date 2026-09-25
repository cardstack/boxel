// Pretui — EmailInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { EmailInput } from './email-input';

// ── EmailInput ← email-input/usage.gts ───────────────────────────────────
// Dropped knobs: none upstream — the full set carries over. Surface
// adaptation on record: boxel-ui's 3-arg @onChange(value, validationError,
// ev) splits into @onInput(value) + @onValidation(errorMessage | null);
// the doc rows below describe the Pretui halves.
class EmailInputUsage extends Component {
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
    return `<EmailInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='EmailInput'
      @description="Wraps boxel-ui's EmailInput — client-side email validation with debounced feedback and blur-gated error surfacing — re-dressed through the Pretui token channel. Committed values arrive via @onInput; the current validation error message (or null) via @onValidation."
      @source={{this.usage}}
    >
      <:example>
        <EmailInput
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
          @defaultValue='Enter email'
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
          @description="Receives the committed value as a string — the first arg of boxel-ui's @onChange."
        />
        <Args.Action
          @name='onValidation'
          @description="Receives the current validation error message, or null when valid/empty — boxel-ui's @onChange validation object, collapsed to its message."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_EMAIL_INPUT: Record<string, unknown> = {
  EmailInput: EmailInputUsage,
};
