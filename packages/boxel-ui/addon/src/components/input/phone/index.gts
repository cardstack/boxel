import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type AsYouType, getAsYouType } from 'awesome-phonenumber';
import { type TCountryCode, countries, getEmojiFlag } from 'countries-list';
import { debounce } from 'lodash';

import validatePhone, {
  DEFAULT_PHONE_REGION_CODE,
  isValidPhone,
  normalizePhone,
} from '../../../helpers/validate-phone.ts';
import BoxelInputGroup from '../../input-group/index.gts';
import { type InputValidationState } from '../index.gts';

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

interface FlagDisplay {
  emoji: string;
  label: string;
  regionCode: string;
}

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
  @tracked private countryFlag: FlagDisplay | null = this.args.value
    ? this.flagFromInput(this.args.value)
    : null;

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
      this.countryFlag = null;
      return;
    }

    const normalization = normalizePhone(input);
    if (!normalization.ok) {
      const validation = normalization.error;
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? validation.message ?? this.fallbackErrorMessage
          : undefined;
    } else {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.setFlagFromRegion(normalization.value.regionCode);
      this.notify(normalization.value.e164);
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
    this.inputValue = value;
    this.updateFlagForInput(value);
    this.debouncedInput(value);
  }

  @action onBlur(): void {
    this.hasBlurred = true;
    this.debouncedInput.flush();
    const formatted = this.formatForDisplay(this.inputValue);
    this.inputValue = formatted;
    this.handleValidation(formatted);
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
      this.countryFlag = null;
      return '';
    }

    const formatted = this.asYouType.reset(sanitized);
    this.updateFlagFromAsYouType();
    return formatted;
  }

  private updateFlagForInput(value: string | null | undefined): void {
    if (!value) {
      this.asYouType.reset();
      this.countryFlag = null;
      return;
    }

    const sanitized = this.sanitizeForFormatting(value);
    if (!sanitized) {
      this.asYouType.reset();
      this.countryFlag = null;
      return;
    }

    this.asYouType.reset(sanitized);
    this.updateFlagFromAsYouType();
  }

  private flagFromInput(value: string): FlagDisplay | null {
    const normalization = normalizePhone(value);
    if (!normalization.ok) {
      return null;
    }
    return this.flagFromRegion(normalization.value.regionCode);
  }

  private updateFlagFromAsYouType(): void {
    try {
      const parsed = this.asYouType.getPhoneNumber();
      this.setFlagFromRegion(parsed?.regionCode);
    } catch {
      this.countryFlag = null;
    }
  }

  private setFlagFromRegion(regionCode?: string | null): void {
    if (!regionCode) {
      this.countryFlag = null;
      return;
    }

    const flag = this.flagFromRegion(regionCode);
    this.countryFlag = flag;
  }

  private flagFromRegion(regionCode: string): FlagDisplay | null {
    const normalizedRegion = regionCode.toUpperCase();
    const emoji = getEmojiFlag(normalizedRegion as TCountryCode);
    if (!emoji) {
      return null;
    }
    const country = countries[normalizedRegion as TCountryCode];
    const label = country?.name
      ? `${country.name} flag`
      : `Flag for ${normalizedRegion}`;
    return {
      emoji,
      label,
      regionCode: normalizedRegion,
    };
  }

  <template>
    <BoxelInputGroup
      type='tel'
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
    >
      <:before as |Accessories|>
        {{#if this.countryFlag}}
          <Accessories.Text class='flag'>
            <span
              class='phone-input__flag'
              aria-hidden='true'
              data-test-boxel-phone-input-flag
            >{{this.countryFlag.emoji}}</span>
            <span class='boxel-sr-only'>{{this.countryFlag.label}}</span>
          </Accessories.Text>
        {{/if}}
      </:before>
    </BoxelInputGroup>
    <style scoped>
      :deep(.flag) {
        padding-block: var(--boxel-sp-5xs);
        padding-right: 0;
        font-size: var(--boxel-font-size-lg);
      }
    </style>
  </template>
}
