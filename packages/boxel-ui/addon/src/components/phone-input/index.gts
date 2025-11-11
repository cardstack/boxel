import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { debounce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type AsYouType, getAsYouType } from 'awesome-phonenumber';

import validatePhoneFormat, {
  type NormalizePhoneFormatResult,
  DEFAULT_PHONE_REGION_CODE,
  DEFAULT_PHONE_VALIDATION_MESSAGE,
  isValidPhoneFormat,
  normalizePhoneFormat,
} from '../../helpers/validate-phone-format.ts';
import { type InputValidationState } from '../input/index.gts';
import BoxelInput from '../input/index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    onChange?: (
      value: string | null,
      validation: NormalizePhoneFormatResult | null,
      ev: Event,
    ) => void;
    placeholder?: string;
    required?: boolean;
    value: string | null;
  };
  Element: HTMLElement;
}

export default class PhoneInput extends Component<Signature> {
  private fallbackErrorMessage = DEFAULT_PHONE_VALIDATION_MESSAGE;
  private asYouType: AsYouType = getAsYouType(DEFAULT_PHONE_REGION_CODE);

  @tracked private validationState: InputValidationState = this.args.value
    ? isValidPhoneFormat(this.args.value)
      ? 'valid'
      : 'invalid'
    : 'initial';
  @tracked private inputValue = this.args.value ?? '';
  @tracked private errorMessage = this.args.value
    ? validatePhoneFormat(this.args.value)?.message
    : '';
  @tracked private hasBlurred = false;

  private notify(
    value: string | null,
    validation: NormalizePhoneFormatResult | null,
    ev: Event,
  ) {
    this.args.onChange?.(value, validation, ev);
  }

  private handleValidation = (input: string, ev: Event) => {
    input = this.sanitizeForFormatting(input);

    let t = ev.target as HTMLInputElement | null;
    let required = this.args.required || t?.required;

    if (!input?.length && !required) {
      this.validationState = 'initial';
      this.errorMessage = undefined;
      this.notify(input, null, ev);
      return;
    }

    const normalized = normalizePhoneFormat(input);
    if (!normalized.ok) {
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? normalized.error.message ?? this.fallbackErrorMessage
          : undefined;
      this.notify(input, normalized, ev);
    } else {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.inputValue = normalized.value.international;
      this.notify(normalized.value.e164, normalized, ev);
    }
  };

  @action onInput(ev: Event): void {
    this.hasBlurred = false;
    if (this.validationState === 'invalid') {
      this.validationState = 'initial';
    }
    this.errorMessage = undefined;
    let value = (ev?.target as HTMLInputElement | null)?.value ?? '';
    this.inputValue = value;
    debounce(this.handleValidation, value, ev, 300);
  }

  @action onBlur(ev: Event): void {
    this.hasBlurred = true;
    const formatted = this.formatForDisplay(this.inputValue);
    this.inputValue = formatted;
    this.handleValidation(this.inputValue, ev);
  }

  private sanitizeForFormatting(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const hasLeadingPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    if (hasLeadingPlus) {
      return digits.length ? `+${digits}` : '+';
    }

    return digits;
  }

  private formatForDisplay(value: string | null): string {
    if (!value) {
      this.asYouType.reset();
      return '';
    }

    const sanitized = this.sanitizeForFormatting(value);
    if (!sanitized) {
      this.asYouType.reset();
      return '';
    }

    const formatted = this.asYouType.reset(sanitized);
    return formatted;
  }

  <template>
    <BoxelInput
      @type='tel'
      @value={{this.inputValue}}
      {{on 'input' this.onInput}}
      @onBlur={{this.onBlur}}
      @state={{this.validationState}}
      @errorMessage={{this.errorMessage}}
      @disabled={{@disabled}}
      @placeholder={{if @placeholder @placeholder 'Enter phone'}}
      @required={{@required}}
      data-test-boxel-phone-input
      ...attributes
    />
  </template>
}
