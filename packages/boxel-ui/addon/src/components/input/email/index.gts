import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { debounce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import validateEmailFormat, {
  type EmailFormatValidationError,
  isValidEmailFormat,
} from '../../../helpers/validate-email-format.ts';
import BoxelInput, { type InputValidationState } from '../index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    onChange?: (
      value: string | null,
      validation: EmailFormatValidationError | null,
      ev: Event,
    ) => void;
    placeholder?: string;
    required?: boolean;
    value: string | null;
  };
  Element: HTMLElement;
}

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid email address';

export default class EmailInput extends Component<Signature> {
  private fallbackErrorMessage = DEFAULT_FALLBACK_MESSAGE;

  @tracked private validationState: InputValidationState = this.args.value
    ? isValidEmailFormat(this.args.value)
      ? 'valid'
      : 'invalid'
    : 'initial';
  @tracked private inputValue = this.args.value ?? '';
  @tracked private errorMessage = this.args.value
    ? validateEmailFormat(this.args.value)?.message
    : '';
  @tracked private hasBlurred = false;

  private notify(
    value: string | null,
    validation: EmailFormatValidationError | null,
    ev: Event,
  ) {
    this.args.onChange?.(value, validation, ev);
  }

  private handleValidation = (input: string, ev: Event) => {
    input = input?.trim();

    let t = ev.target as HTMLInputElement | null;
    let required = this.args.required || t?.required;

    if (!input?.length && !required) {
      this.validationState = 'initial';
      this.errorMessage = undefined;
      this.notify(input, null, ev);
      return;
    }

    const validation = validateEmailFormat(input);
    if (validation) {
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? validation.message ?? this.fallbackErrorMessage
          : undefined;
    } else {
      this.validationState = 'valid';
      this.errorMessage = undefined;
    }

    this.notify(input, validation, ev);
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
    this.handleValidation(this.inputValue, ev);
  }

  <template>
    <BoxelInput
      @type='email'
      @value={{this.inputValue}}
      {{on 'input' this.onInput}}
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
