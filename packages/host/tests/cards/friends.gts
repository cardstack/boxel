import {
  contains,
  linksToMany,
  field,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Friends extends CardDef {
  @field firstName = contains(StringField);
  @field friends = linksToMany(() => Friends);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Friends) {
      return this.firstName;
    },
  });
}
