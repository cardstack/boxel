import {
  contains,
  linksToMany,
  field,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Friends extends CardDef {
  @field firstName = contains(StringField);
  @field friends = linksToMany(() => Friends);
  @field title = contains(StringField, {
    computeVia: function (this: Friends) {
      return this.firstName;
    },
  });
}
