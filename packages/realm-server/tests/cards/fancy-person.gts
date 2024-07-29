import {
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Person } from './person';

export class FancyPerson extends Person {
  static displayName = 'Person';
  @field firstName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: FancyPerson) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <style>
        .fancy-border {
          border: 1px solid pink;
        }
      </style>
      <h1 data-test-card class='.fancy-border'><@fields.firstName /></h1>
    </template>
  };
}
