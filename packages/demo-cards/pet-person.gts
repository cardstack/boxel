import {
  contains,
  linksTo,
  linksToMany,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Pet } from './pet';
import { Person } from './person';

export class PetPerson extends Card {
  static displayName = 'Pet Person';
  @field firstName = contains(StringCard);
  @field pets = linksToMany(Pet);
  @field friend = linksTo(Person);
  @field title = contains(StringCard, {
    computeVia: function (this: PetPerson) {
      return `${this.firstName} Pet Person`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3><@fields.firstName /></h3>
      Pets:
      <@fields.pets />
      Friend:
      <@fields.friend />
    </template>
  };
}
