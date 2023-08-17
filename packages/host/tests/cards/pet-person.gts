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
import { GridContainer } from '@cardstack/boxel-ui';

export class PetPerson extends Card {
  static displayName = 'Pet Person';
  @field firstName = contains(StringCard);
  @field friend = linksTo(Person);
  @field pets = linksToMany(Pet);
  @field title = contains(StringCard, {
    computeVia: function (this: PetPerson) {
      return `${this.firstName} Pet Person`;
    },
  });
  @field description = contains(StringCard, {
    computeVia: () => 'A person with pets',
  });
  @field thumbnailURL = contains(StringCard, { computeVia: () => null });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <h3><@fields.firstName /></h3>
        Pets:
        <@fields.pets />
        Friend:
        <@fields.friend />
      </GridContainer>
    </template>
  };
}
