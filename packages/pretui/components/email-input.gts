// Pretui — EmailInput: boxel-ui's validated email field in Pretui cloth.
import Component from '@glimmer/component';
import { EmailInput as BoxelEmailInput } from '@cardstack/boxel-ui/components';
import type { EmailFormatValidationError } from '@cardstack/boxel-ui/helpers';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_FONT } from '../internal/extras';
import { FieldDress } from '../internal/field-dress';

// boxel-ui's validation engine (format checks, debounced feedback,
// blur-gated error surfacing) is the value; only the cloth changes. The
// shared FieldDress wrapper carries the re-skin through the semantic-token +
// --boxel-* custom-property channel — no CSS reaches into boxel-ui markup. Surface
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
    <FieldDress data-test-pretui-email-input ...attributes>
      <BoxelEmailInput
        @value={{this.boxelValue}}
        @onChange={{this.handleChange}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </FieldDress>
  </template>
}
