import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { debounce } from 'lodash';

import validateEmail from '../../../helpers/validate-email.ts';
import BoxelInput, { type InputValidationState } from '../index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    fallbackErrorMessage?: string;
    onChange?: (value: string | null) => void;
    value: string | null;
  };
  Element: HTMLElement;
}

const DEFAULT_FALLBACK_MESSAGE = 'Enter a valid email address';

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
      this.validationState = validateEmail(initial) ? 'valid' : 'initial';
    }
  }

  private get fallbackErrorMessage() {
    return this.args.fallbackErrorMessage ?? DEFAULT_FALLBACK_MESSAGE;
  }

  private notify(value: string | null) {
    this.args.onChange?.(value);
  }

  private debouncedInput = debounce((input: string) => {
    if (input === '') {
      this.validationState = 'initial';
      this.errorMessage = undefined;
      this.notify(null);
      return;
    }

    if (validateEmail(input)) {
      this.validationState = 'valid';
      this.errorMessage = undefined;
      this.notify(input);
    } else {
      this.validationState = this.hasBlurred ? 'invalid' : 'initial';
      this.errorMessage =
        this.validationState === 'invalid'
          ? this.fallbackErrorMessage
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

    if (this.draftValue === '') {
      this.validationState = 'initial';
      this.errorMessage = undefined;
      return;
    }

    if (!validateEmail(this.draftValue)) {
      this.validationState = 'invalid';
      const input = event.target as HTMLInputElement | null;
      const message = input?.validationMessage?.trim();
      this.errorMessage =
        message && message.length > 0 ? message : this.fallbackErrorMessage;
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
      data-test-boxel-email-input
      ...attributes
    />
  </template>
}
