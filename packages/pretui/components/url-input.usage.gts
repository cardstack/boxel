// Pretui — UrlInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { UrlInput } from './url-input';

// ── UrlInput — typed-input split, fresh page ─────────────────────────────
// Type-specific behavior: EmailInput-shaped validation (boxel-ui has no
// URL engine, so the checks are Pretui's own — URL parse + http/https
// protocol, blur-gated, live revalidation once touched).
class UrlInputUsage extends Component {
  @tracked value = '';
  @tracked lastError: string | null = null;
  @tracked placeholder = 'https://example.com';
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
    return `<UrlInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='UrlInput'
      @description='URL entry riding boxel-ui BoxelInput (@type=url) with an EmailInput-shaped validation surface: blur-gated first error, live revalidation once touched, valid checkmark on a good committed value. Requires an http:// or https:// URL.'
      @source={{this.usage}}
    >
      <:example>
        <UrlInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setValue}}
          @onValidation={{this.setError}}
        />
        <p class='pretui-demo-readout' data-test-url-readout>
          value = “{{this.value}}” · error =
          {{if this.lastError this.lastError 'null'}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @description='An empty field counts as invalid on blur once required.'
          @onInput={{this.setRequired}}
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
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string.'
        />
        <Args.Action
          @name='onValidation'
          @description='Receives the current validation error message, or null when valid/empty — the EmailInput split.'
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

export const DEMOS_URL_INPUT: Record<string, unknown> = {
  UrlInput: UrlInputUsage,
};
