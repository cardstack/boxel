// Pretui — Field usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Field } from './field';
import { Input } from './input';

// ── Field ← field-container/usage.gts ────────────────────────────────────
// Dropped knobs: @tag (Field renders a fixed div wrapper), @fieldId (a
// controlId is generated and yielded instead), @icon (no icon slot),
// @vertical (Field is vertical-only by design), @inline (no compact
// horizontal layout), @horizontalLabelSize / @labelFontSize (no horizontal
// label column), @centeredDisplay (no centered display mode).
export class FieldUsage extends Component {
  @tracked label = 'Full Name of the Issuer';
  @tracked hint = 'As printed on the certificate';
  @tracked error = '';
  @tracked value = 'Gary Walker';
  setLabel = (v: string) => (this.label = v);
  setHint = (v: string) => (this.hint = v);
  setError = (v: string) => (this.error = v);
  setValue = (v: string) => (this.value = v);
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (this.hint) bits.push(`@hint='${this.hint}'`);
    if (this.error) bits.push(`@error='${this.error}'`);
    return `<Field ${bits.join(' ')} as |controlId|>…</Field>`;
  }
  <template>
    <FreestyleUsage
      @name='Field'
      @description='Form-field wrapper that pairs a label with its input control, plus helper text and validation messages — the standard layout primitive for form rows.'
      @source={{this.usage}}
    >
      <:example>
        <Field @label={{this.label}} @hint={{this.hint}} @error={{this.error}} as |controlId|>
          <Input
            @controlId={{controlId}}
            @value={{this.value}}
            @onInput={{this.setValue}}
          />
        </Field>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @description='field label'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='Helper text on the reserved message line — no layout shift when it appears.'
          @onInput={{this.setHint}}
        />
        <Args.String
          @name='error'
          @value={{this.error}}
          @description='Error message — replaces hint on the reserved message line and paints the inner input invalid.'
          @onInput={{this.setError}}
        />
        <Args.Yield
          @description="Yield value or form field; yields the generated controlId — wire it to the control's @controlId for label association."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FIELD: Record<string, unknown> = {
  Field: FieldUsage,
};
