import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type AsYouType, getAsYouType } from 'awesome-phonenumber';
import { debounce } from 'lodash';

import validatePhone, {
  DEFAULT_PHONE_REGION_CODE,
  isValidPhone,
} from '../../../helpers/validate-phone.ts';
import BoxelInput, { type InputValidationState } from '../index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    onChange?: (value: string | null) => void;
    placeholder?: string;
    required?: boolean;
    value: string | null;
  };
  Element: HTMLElement;
}

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid phone number';
const DEFAULT_REQUIRED_MESSAGE = 'Enter a phone number';

export default class PhoneInput extends Component<Signature> {
  private fallbackErrorMessage = DEFAULT_FALLBACK_MESSAGE;
  private requiredErrorMessage = DEFAULT_REQUIRED_MESSAGE;
  private asYouType: AsYouType = getAsYouType(DEFAULT_PHONE_REGION_CODE);

  @tracked private validationState: InputValidationState = this.args.value
    ? isValidPhone(this.args.value)
      ? 'valid'
      : 'invalid'
    : 'initial';
  @tracked private inputValue = this.args.value
    ? this.formatForDisplay(this.args.value)
    : '';
  @tracked private errorMessage = this.args.value
    ? validatePhone(this.args.value)?.message
    : '';
  @tracked private hasBlurred = false;

  private notify(value: string | null) {
    this.args.onChange?.(value);
  }

  private handleValidation = (input: string) => {
    input = input?.trim();
    if (!input?.length) {
      if (this.args.required && this.hasBlurred) {
        this.validationState = 'invalid';
        this.errorMessage = this.requiredErrorMessage;
      } else if (this.hasBlurred) {
        this.validationState = 'initial';
        this.errorMessage = undefined;
        this.notify(null);
      } else {
        this.validationState = 'initial';
        this.errorMessage = undefined;
      }
      return;
    }

    const validation = validatePhone(input);
    if (validation) {
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? validation.message ?? this.fallbackErrorMessage
          : undefined;
    } else {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.notify(input);
    }
  };

  private debouncedInput = debounce(
    (input: string) => this.handleValidation(input),
    300,
  );

  @action onInput(value: string): void {
    this.hasBlurred = false;
    if (this.validationState === 'invalid') {
      this.validationState = 'initial';
    }
    this.errorMessage = undefined;
    const formattedValue = this.formatForDisplay(value);
    this.inputValue = formattedValue;
    this.debouncedInput(formattedValue);
  }

  @action onBlur(): void {
    this.hasBlurred = true;
    this.debouncedInput.flush();
    this.handleValidation(this.inputValue);
  }

  override willDestroy(): void {
    this.debouncedInput.cancel();
    super.willDestroy();
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

    return this.asYouType.reset(sanitized);
  }

  <template>
    <BoxelInput
      @type='tel'
      @value={{this.inputValue}}
      @onInput={{this.onInput}}
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
