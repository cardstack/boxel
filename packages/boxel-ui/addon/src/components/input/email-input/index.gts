import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { debounce } from 'lodash';

import validateEmail, {
  isValidEmail,
} from '../../../helpers/validate-email.ts';
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

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid email address';
const DEFAULT_REQUIRED_MESSAGE = 'Enter an email address';

export default class EmailInput extends Component<Signature> {
  private fallbackErrorMessage = DEFAULT_FALLBACK_MESSAGE;
  private requiredErrorMessage = DEFAULT_REQUIRED_MESSAGE;

  @tracked private validationState: InputValidationState = this.args.value
    ? isValidEmail(this.args.value)
      ? 'valid'
      : 'invalid'
    : 'initial';
  @tracked private inputValue = this.args.value ?? '';
  @tracked private errorMessage = this.args.value
    ? validateEmail(this.args.value)?.message
    : '';
  @tracked private hasBlurred = false;

  private notify(value: string | null) {
    this.args.onChange?.(value);
  }

  private handleValidation = (input: string) => {
    if (!input || input?.trim() === '') {
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

    const validation = validateEmail(input);
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
    this.inputValue = value;
    this.debouncedInput(value);
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

  <template>
    <BoxelInput
      @type='email'
      @value={{this.inputValue}}
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
