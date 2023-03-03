import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field email = contains(StringCard);
  @field posts = contains(IntegerCard);
  @field fullName = contains(StringCard, {
    computeVia: async function (this: Person) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
    </template>
  };
}
