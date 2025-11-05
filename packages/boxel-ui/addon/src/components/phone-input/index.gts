import { action } from '@ember/object';
import { debounce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type AsYouType, getAsYouType } from 'awesome-phonenumber';
import { type TCountryCode, countries, getEmojiFlag } from 'countries-list';

import validatePhoneFormat, {
  type NormalizePhoneFormatResult,
  DEFAULT_PHONE_REGION_CODE,
  isValidPhoneFormat,
  normalizePhoneFormat,
} from '../../helpers/validate-phone-format.ts';
import { type InputValidationState } from '../input/index.gts';
import BoxelInputGroup from '../input-group/index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    onChange?: (
      value: string | null,
      validation: NormalizePhoneFormatResult | null,
      ev?: Event,
    ) => void;
    placeholder?: string;
    required?: boolean;
    value: string | null;
  };
  Element: HTMLElement;
}

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid phone number';

interface FlagDisplay {
  emoji: string;
  label: string;
  regionCode: string;
}

export default class PhoneInput extends Component<Signature> {
  private fallbackErrorMessage = DEFAULT_FALLBACK_MESSAGE;
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
  @tracked private countryFlag?: FlagDisplay | null;

  private notify(
    value: string | null,
    validation: NormalizePhoneFormatResult | null,
    ev?: Event,
  ) {
    this.args.onChange?.(value, validation, ev);
  }

  private handleValidation = (input: string, ev?: Event) => {
    input = this.sanitizeForFormatting(input);

    let t = ev?.target as HTMLInputElement | null;
    let required = this.args.required || t?.required;

    if (!input?.length && !required) {
      this.validationState = 'initial';
      this.errorMessage = undefined;
      this.countryFlag = null;
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
      this.setFlagFromRegion(normalized.value.regionCode);
      this.inputValue = normalized.value.international;
      this.notify(normalized.value.e164, normalized, ev);
    }
  };

  @action onInput(value: string): void {
    this.hasBlurred = false;
    if (this.validationState === 'invalid') {
      this.validationState = 'initial';
    }
    this.errorMessage = undefined;
    this.inputValue = value;
    this.updateFlagForInput(value);
    debounce(this.handleValidation, value, undefined, 300);
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
      @type='tel'
      @value={{this.inputValue}}
      @onInput={{this.onInput}}
      @onBlur={{this.onBlur}}
      @state={{this.validationState}}
      @errorMessage={{this.errorMessage}}
      @disabled={{@disabled}}
      @placeholder={{if @placeholder @placeholder 'Enter phone'}}
      @required={{@required}}
      data-test-boxel-phone-input-group
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
