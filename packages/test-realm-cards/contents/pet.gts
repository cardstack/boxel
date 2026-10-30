import {
  contains,
  linksTo,
  field,
  Component,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { Person } from './person';

export class Pet extends CardDef {
  @field firstName = contains(StringField);
  @field owner = linksTo(Person);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Pet) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>Owned by:
      <@fields.owner />
      <h1><@fields.cardTitle /></h1>
    </template>
  };
}
