import {
  contains,
  linksTo,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Person } from './person';

export class Pet extends Card {
  @field firstName = contains(StringCard);
  @field owner = linksTo(Person);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>Owned by: <@fields.owner />
    </template>
  };
}
