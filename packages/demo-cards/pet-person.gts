import {
  contains,
  linksToMany,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer } from '@cardstack/boxel-ui';
import { Pet } from './pet';

export class PetPerson extends Card {
  @field firstName = contains(StringCard);
  @field pets = linksToMany(Pet);
  @field title = contains(StringCard, {
    computeVia: function (this: PetPerson) {
      return `${this.firstName} Pets`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <h3><@fields.firstName /></h3>
        <@fields.pets />
      </CardContainer>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <h2><@fields.firstName /></h2>
        <@fields.pets />
      </CardContainer>
    </template>
  };
}
