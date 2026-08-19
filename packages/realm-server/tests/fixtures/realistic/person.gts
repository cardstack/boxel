import {
  contains,
  field,
  Component,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringField);
  @field cardTitle = contains(StringField, {
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
