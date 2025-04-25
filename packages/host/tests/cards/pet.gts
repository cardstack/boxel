import {
  contains,
  linksTo,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Person } from './person';

export class Pet extends CardDef {
  @field firstName = contains(StringField);
  @field owner = linksTo(Person);
  @field title = contains(StringField, {
    computeVia: function (this: Pet) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>Owned by:
      <@fields.owner />
      <h1><@fields.title /></h1>
    </template>
  };
}
