import { StringField, Component, field, CardDef, contains } from './card-api';
import {
  EmailInput,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import MailIcon from '@cardstack/boxel-icons/mail';

export default class EmailField extends StringField {
  static icon = MailIcon;
  static displayName = 'Email';

  static edit = class Edit extends Component<typeof this> {
    <template>
      <EmailInput
        @value={{@model}}
        @onChange={{@set}}
        @disabled={{not @canEdit}}
      />
    </template>
  };

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
