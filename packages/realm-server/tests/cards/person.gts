import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.firstName /></h1>
    </template>
  };
}

export let counter = 0;
export function increment() {
  counter++;
}
