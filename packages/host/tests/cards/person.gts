import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import NumberCard from 'https://cardstack.com/base/number';

export class Person extends CardDef {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field email = contains(StringCard);
  @field posts = contains(NumberCard);
  @field fullName = contains(StringCard, {
    computeVia: async function (this: Person) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field description = contains(StringCard, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.title /></h1>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.title /></h1>
    </template>
  };
}

export class PersonField extends FieldDef {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field email = contains(StringCard);
  @field posts = contains(NumberCard);
  @field fullName = contains(StringCard, {
    computeVia: async function (this: Person) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field description = contains(StringCard, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.title /></h1>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.title /></h1>
    </template>
  };
}
