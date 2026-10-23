// Pretui — PhoneInput: boxel-ui's formatted phone field in Pretui cloth.
import Component from '@glimmer/component';
import { PhoneInput as BoxelPhoneInput } from '@cardstack/boxel-ui/components';
import type { NormalizePhoneFormatResult } from '@cardstack/boxel-ui/helpers';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_FONT } from '../internal/extras';
import { FieldDress } from '../internal/field-dress';

// Same wrap as EmailInput: boxel-ui's awesome-phonenumber machinery
// (as-you-type formatting, E.164 normalization, region validation) intact,
// Pretui cloth via the token channel. onChange's NormalizePhoneFormatResult
// collapses to @onValidation(errorMessage | null); @onInput receives the
// sanitized value boxel emits (E.164 when valid, trimmed digits otherwise).

export interface PhoneInputSignature {
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

export class PhoneInput extends Component<PhoneInputSignature> {
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
    validation: NormalizePhoneFormatResult | null,
    _ev: Event,
  ) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value ?? '',
    );
    this.args.onValidation?.(
      validation && !validation.ok ? validation.error.message : null,
    );
  };
  <template>
    <FieldDress data-test-pretui-phone-input ...attributes>
      <BoxelPhoneInput
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
