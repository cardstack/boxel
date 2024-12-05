import {
  StringField,
  Component,
  field,
  CardDef,
  contains,
} from 'https://cardstack.com/base/card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import MailIcon from '@cardstack/boxel-icons/mail';

export class EmailField extends StringField {
  static icon = MailIcon;
  static displayName = 'Email';

  static edit = class Edit extends Component<typeof EmailField> {
    <template>
      <BoxelInput
        type='email'
        value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof EmailField> {
    <template>
      {{#if @model}}
        <div class='row'>
          <MailIcon class='icon' />
          <span>{{@model}}</span>
        </div>
      {{/if}}
      <style scoped>
        .row {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          flex-shrink: 0;
          color: var(--boxel-400);
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
