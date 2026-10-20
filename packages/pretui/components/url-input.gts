// Pretui — UrlInput: a URL field with blur-gated validation.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_FONT } from '../internal/extras';

// boxel-ui has no URL validation engine (email/phone only), so this pairs
// BoxelInput @type='url' with an EmailInput-shaped validation surface:
// blur-gated first error (URL parse + http/https protocol check), live
// revalidation once touched so recovery is instant, valid checkmark on a
// good committed value. @onInput(value) + @onValidation(error | null),
// exactly the EmailInput split.

export interface UrlInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    onValidation?: (error: string | null) => void;
  };
  Element: HTMLDivElement;
}

export class UrlInput extends Component<UrlInputSignature> {
  @tracked internal = this.args.value ?? '';
  @tracked touched = false;
  @tracked error: string | null = null;

  get current() {
    return this.args.value ?? this.internal;
  }
  get state() {
    if (!this.touched) {
      return 'initial';
    }
    if (this.error) {
      return 'invalid';
    }
    return this.current ? 'valid' : 'initial';
  }
  get errorMessage() {
    return this.error ?? undefined;
  }
  private validate(v: string): string | null {
    if (!v) {
      return this.required ? 'URL is required.' : null;
    }
    let parsed;
    try {
      parsed = new URL(v);
    } catch {
      return 'Not a valid URL — include the protocol (https://…).';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must use http:// or https://.';
    }
    return null;
  }
  private report(error: string | null) {
    this.error = error;
    this.args.onValidation?.(error);
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleInput = (value: string) => {
    this.internal = value;
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
    if (this.touched) {
      this.report(this.validate(value));
    }
  };
  handleBlur = (_ev: Event) => {
    this.touched = true;
    this.report(this.validate(this.current));
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-state={{this.state}}
      data-test-pretui-url-input
      ...attributes
    >
      <BoxelInput
        @type='url'
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @state={{this.state}}
        @errorMessage={{this.errorMessage}}
        @onInput={{this.handleInput}}
        @onBlur={{this.handleBlur}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </div>
    <style scoped>
      @layer PretComponent {
        /* Same re-skin channel as EmailInput — see that component's note. */
        .pretui-boxelwrap {
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: var(--boxel-form-control-height-sm);
          --boxel-input-height: var(--boxel-form-control-height-sm);
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          --boxel-font-size-sm: var(--boxel-font-size-2xs);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          --boxel-sp-sm: calc(0.625rem - 1px);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-boxelwrap {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
      }
    </style>
  </template>
}
