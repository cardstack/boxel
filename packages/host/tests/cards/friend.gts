import { contains, linksTo, field } from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import StringCard from 'https://cardstack.com/base/string';

export class Friend extends CardDef {
  @field firstName = contains(StringCard);
  @field friend = linksTo(() => Friend);
  @field title = contains(StringCard, {
    computeVia: function (this: Friend) {
      return this.firstName;
    },
  });
}
