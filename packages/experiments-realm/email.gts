import {
  StringField,
  Component,
  field,
  CardDef,
  contains,
} from 'https://cardstack.com/base/card-api';
import {
  BoxelInput,
  type BoxelInputValidationState,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import MailIcon from '@cardstack/boxel-icons/mail';
import { debounce } from 'lodash';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { EntityDisplay } from './components/entity-display';

// We use simple regex here to validate common email formats
// This is definitely NOT a full email validation
// https://ihateregex.io/expr/email/
function validateEmail(email: string) {
  const emailPattern = /^[^@ \t\r\n]+@[^@ \t\r\n]+\.[^@ \t\r\n]+$/;
  return emailPattern.test(email);
}

class EmailEditTemplate extends Component<typeof EmailField> {
  @tracked validationState: BoxelInputValidationState = 'initial';

  private debouncedInput = debounce((input: string) => {
    if (input === '') {
      this.validationState = 'initial';
    } else {
      this.validationState = validateEmail(input) ? 'valid' : 'invalid';
    }
    if (this.validationState === 'initial') {
      this.args.set(null);
    } else if (this.validationState === 'valid') {
      this.args.set(input);
    }
  }, 300);

  @action onInput(v: string): void {
    this.debouncedInput(v);
  }

  get errorMessage() {
    return 'Invalid email address';
  }

  <template>
    <BoxelInput
      @type='email'
      @value={{@model}}
      @onInput={{this.onInput}}
      @disabled={{not @canEdit}}
      @state={{this.validationState}}
      @errorMessage={{this.errorMessage}}
    />
  </template>
}

export class EmailField extends StringField {
  static icon = MailIcon;
  static displayName = 'Email';

  static atom = class Atom extends Component<typeof EmailField> {
    <template>
      {{#if @model}}
        <EntityDisplay @name={{@model}} @underline={{false}}>
          <:thumbnail>
            <MailIcon class='icon' />
          </:thumbnail>
        </EntityDisplay>
      {{/if}}

      <style scoped>
        .icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          flex-shrink: 0;
          color: var(--boxel-400);
        }
      </style>
    </template>
  };
  static edit = EmailEditTemplate;
}

export class CardWithEmail extends CardDef {
  static displayName = 'Card with Email';
  @field email = contains(EmailField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <@fields.email @format='atom' />
    </template>
  };
}
