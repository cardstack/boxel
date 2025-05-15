import {
  CardDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';

export class User extends CardDef {
  static displayName = 'User';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: User) {
      return this.name;
    },
  });
}
