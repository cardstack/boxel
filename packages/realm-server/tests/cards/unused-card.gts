import {
  contains,
  field,
  Component,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class UnusedCard extends CardDef {
  @field firstName = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: UnusedCard) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
    </template>
  };
}
