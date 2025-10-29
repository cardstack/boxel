import {
  CardDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import EmailField from 'https://cardstack.com/base/email';

export class User extends CardDef {
  static displayName = 'User';
  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field title = contains(StringField, {
    computeVia: function (this: User) {
      return this.name;
    },
  });
}
