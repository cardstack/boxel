// Pretui — Textarea usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Textarea } from './textarea';
import { Field } from './field';

// ── Textarea ← input/usage.gts (textarea type) ───────────────────────────
// Same BoxelInput retrofit as Input, pinned to @type='textarea' with the
// Pretui textarea metrics (64px min-height, vertical-only resize).
export class TextareaUsage extends Component {
  @tracked value = '';
  @tracked placeholder = 'Tell us more…';
  @tracked invalid = false;
  @tracked disabled = false;
  @tracked helperText = '';
  @tracked errorMessage = 'This value is invalid.';
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setInvalid = (v: boolean) => (this.invalid = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setHelperText = (v: string) => (this.helperText = v);
  setErrorMessage = (v: string) => (this.errorMessage = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.invalid) bits.push('@invalid={{true}}');
    bits.push('@onInput={{this.setValue}}');
    return `<Textarea ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Textarea'
      @description='Multi-line text entry riding boxel-ui BoxelInput (@type=textarea) — validation states and error/helper rows in the Pretui control dress; vertical-only resize.'
      @source={{this.usage}}
    >
      <:example>
        <Field @label='Notes' as |controlId|>
          <Textarea
            @controlId={{controlId}}
            @value={{this.value}}
            @placeholder={{this.placeholder}}
            @invalid={{this.invalid}}
            @disabled={{this.disabled}}
            @helperText={{this.helperText}}
            @errorMessage={{this.errorMessage}}
            @onInput={{this.setValue}}
          />
        </Field>
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='controlId'
          @description="The textarea's id for label wiring — supplied by the wrapping Field's yielded controlId."
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='invalid'
          @value={{this.invalid}}
          @description='Paints the destructive ring and enables the errorMessage row.'
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
          @description='Error row under the control; renders only while @invalid.'
          @onInput={{this.setErrorMessage}}
        />
        <Args.String
          @name='helperText'
          @value={{this.helperText}}
          @description='Helper row under the control.'
          @onInput={{this.setHelperText}}
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TEXTAREA: Record<string, unknown> = {
  Textarea: TextareaUsage,
};
