import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { debounce } from 'lodash';

import isValidEmail, {
  validateEmail as describeEmailValidation,
} from '../../../helpers/validate-email.ts';
import BoxelInput, { type InputValidationState } from '../index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    fallbackErrorMessage?: string;
    onChange?: (value: string | null) => void;
    placeholder?: string;
    required?: boolean;
    value: string | null;
  };
  Element: HTMLElement;
}

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid email address';
const DEFAULT_REQUIRED_MESSAGE = 'Enter an email address';

export default class EmailInput extends Component<Signature> {
  @tracked validationState: InputValidationState = 'initial';
  @tracked draftValue: string;
  @tracked errorMessage: string | undefined;

  private hasBlurred = false;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    const initial = this.args.value ?? '';
    this.draftValue = initial;
    if (initial !== '') {
      this.validationState = isValidEmail(initial) ? 'valid' : 'initial';
    }
  }

  private get fallbackErrorMessage() {
    return this.args.fallbackErrorMessage ?? DEFAULT_FALLBACK_MESSAGE;
  }

  private get requiredErrorMessage() {
    return this.args.fallbackErrorMessage ?? DEFAULT_REQUIRED_MESSAGE;
  }

  private notify(value: string | null) {
    this.args.onChange?.(value);
  }

  private debouncedInput = debounce((input: string) => {
    if (!input || input === '') {
      if (this.args.required && this.hasBlurred) {
        this.validationState = 'invalid';
        this.errorMessage = this.requiredErrorMessage;
      } else {
        this.validationState = 'initial';
        this.errorMessage = undefined;
      }
      this.notify(null);
      return;
    }

    const validation = describeEmailValidation(input);
    if (!validation) {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.notify(input);
    } else {
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? validation.message ?? this.fallbackErrorMessage
          : undefined;
      this.notify(null);
    }
  }, 300);

  @action onInput(value: string): void {
    this.hasBlurred = false;
    if (this.validationState === 'invalid') {
      this.validationState = 'initial';
    }
    this.errorMessage = undefined;
    this.draftValue = value;
    this.debouncedInput(value);
  }

  @action onBlur(event: Event): void {
    this.hasBlurred = true;
    this.debouncedInput.flush();

    if (!this.draftValue || this.draftValue === '') {
      if (this.args.required) {
        this.validationState = 'invalid';
        const input = event.target as HTMLInputElement | null;
        const message = input?.validationMessage?.trim();
        this.errorMessage =
          message && message.length > 0 ? message : this.requiredErrorMessage;
        this.notify(null);
      } else {
        this.validationState = 'initial';
        this.errorMessage = undefined;
      }
      return;
    }

    const validation = describeEmailValidation(this.draftValue);
    if (validation) {
      this.validationState = 'invalid';
      const input = event.target as HTMLInputElement | null;
      const message = input?.validationMessage?.trim();
      this.errorMessage =
        validation.message ??
        (message && message.length > 0 ? message : undefined) ??
        this.fallbackErrorMessage;
      this.notify(null);
    } else {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.notify(this.draftValue);
    }
  }

  <template>
    <BoxelInput
      @type='email'
      @value={{this.draftValue}}
      @onInput={{this.onInput}}
      @onBlur={{this.onBlur}}
      @state={{this.validationState}}
      @errorMessage={{this.errorMessage}}
      @disabled={{@disabled}}
      @placeholder={{if @placeholder @placeholder 'Enter email'}}
      @required={{@required}}
      data-test-boxel-email-input
      ...attributes
    />
  </template>
}
