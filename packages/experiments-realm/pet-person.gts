import {
  contains,
  linksTo,
  linksToMany,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Pet } from './pet';
import { Person } from './person';
import { GridContainer } from '@cardstack/boxel-ui/components';

export class PetPerson extends CardDef {
  static displayName = 'Pet Person';
  @field firstName = contains(StringField);
  @field pets = linksToMany(Pet);
  @field friend = linksTo(Person);
  @field title = contains(StringField, {
    computeVia: function (this: PetPerson) {
      return `${this.firstName} Pet Person`;
    },
  });

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

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <GridContainer class='container'>
        <h2><@fields.title /></h2>
        <h2><@fields.firstName /></h2>
        Pets:
        <@fields.pets />
        Friend:
        <@fields.friend />
      </GridContainer>
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
