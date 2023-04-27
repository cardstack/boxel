import {
  contains,
  linksToMany,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer } from '@cardstack/boxel-ui';
import { Pet } from './pet';

export class PetPerson extends Card {
  @field firstName = contains(StringCard);
  @field pets = linksToMany(Pet);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: PetPerson) {
      let metadata = new MetadataCard();
      metadata.title = `${this.firstName} Pets`;
      return metadata;
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
