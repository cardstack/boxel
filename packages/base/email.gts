import { action } from '@ember/object';
import { StringField, Component, field, CardDef, contains } from './card-api';
import {
  EmailInput,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import {
  not,
  type EmailFormatValidationError,
} from '@cardstack/boxel-ui/helpers';
import { fieldSerializer } from '@cardstack/runtime-common';

import MailIcon from '@cardstack/boxel-icons/mail';

class Edit extends Component<typeof EmailField> {
  @action private handleChange(
    value: string,
    validation: EmailFormatValidationError,
  ) {
    if (validation === null && this.args.model !== value) {
      this.args.set(value);
    }
  }

  <template>
    <EmailInput
      @value={{@model}}
      @onChange={{this.handleChange}}
      @disabled={{not @canEdit}}
    />
  </template>
}

export default class EmailField extends StringField {
  static icon = MailIcon;
  static displayName = 'Email';
  static [fieldSerializer] = 'email';

  static edit = Edit;

  static atom = class Atom extends Component<typeof EmailField> {
    <template>
      {{#if @model}}
        <EntityDisplayWithIcon @title={{@model}} @underline={{false}}>
          <:title>
            <a href='mailto:{{@model}}' rel='noopener noreferrer'>
              {{@model}}
            </a>
          </:title>
          <:icon>
            <MailIcon class='icon' />
          </:icon>
        </EntityDisplayWithIcon>
      {{/if}}
      <style scoped>
        .icon {
          color: var(--boxel-400);
        }
        a:hover {
          text-decoration: underline;
          color: inherit;
        }
      </style>
    </template>
  };
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
