// Pretui — EmailInput: boxel-ui's validated email field in Pretui cloth.
import Component from '@glimmer/component';
import { EmailInput as BoxelEmailInput } from '@cardstack/boxel-ui/components';
import type { EmailFormatValidationError } from '@cardstack/boxel-ui/helpers';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';

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
      />
    </div>
    <style scoped>
      /* Pretui control dress fed into boxel-ui's Input via its token
         channel: semantic vars (--background/--border/--ring read the
         Pretui field tokens) plus the --boxel-* dimension knobs. The two
         --boxel-sp-* overrides tune boxel's inner padding so the control
         lands on the h28 / 0-9px Pretui input geometry. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}
