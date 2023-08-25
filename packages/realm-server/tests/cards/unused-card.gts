import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class UnusedCard extends CardDef {
  @field firstName = contains(StringCard);
  @field title = contains(StringCard, {
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
