import {
  contains,
  linksToMany,
  field,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Friends extends CardDef {
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
  @field title = contains(StringCard, {
    computeVia: function (this: Friends) {
      return this.firstName;
    },
  });
}
