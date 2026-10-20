// Pretui — EmailInput: boxel-ui's validated email field in Pretui cloth.
import Component from '@glimmer/component';
import { EmailInput as BoxelEmailInput } from '@cardstack/boxel-ui/components';
import type { EmailFormatValidationError } from '@cardstack/boxel-ui/helpers';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_FONT } from '../internal/extras';

// boxel-ui's validation engine (format checks, debounced feedback,
// blur-gated error surfacing) is the value; only the cloth changes. The
// wrapper div carries the re-skin through the semantic-token + --boxel-*
// custom-property channel — no CSS reaches into boxel-ui markup. Surface
// adaptation: boxel's 3-arg onChange(value, validationError, ev) splits
// into Pretui's @onInput(value) + @onValidation(errorMessage | null).

export interface EmailInputSignature {
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

export class EmailInput extends Component<EmailInputSignature> {
  get boxelValue() {
    return this.args.value ?? null;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleChange = (
    value: string | null,
    validation: EmailFormatValidationError | null,
    _ev: Event,
  ) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value ?? '',
    );
    this.args.onValidation?.(validation ? validation.message : null);
  };
  <template>
    <div class='pretui-boxelwrap' data-test-pretui-email-input ...attributes>
      <BoxelEmailInput
        @value={{this.boxelValue}}
        @onChange={{this.handleChange}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </div>
    <style scoped>
      @layer PretComponent {
        /* Input's field style, fed into boxel-ui's Input through its token
           channel: --background and --border plus the --boxel-* dimension
           knobs */
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
