import { GridContainer } from '@cardstack/boxel-ui/components';

import {
  contains,
  linksTo,
  linksToMany,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Person } from './person';
import { Pet } from './pet';

export class PetPerson extends CardDef {
  static displayName = 'Pet Person';
  @field firstName = contains(StringField);
  @field friend = linksTo(Person);
  @field pets = linksToMany(Pet);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PetPerson) {
      return `${this.firstName} Pet Person`;
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: () => 'A person with pets',
  });
  @field cardThumbnailURL = contains(StringField, { computeVia: () => null });

  static fitted = class Fitted extends Component<typeof this> {
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

export class PetPersonField extends FieldDef {
  @field firstName = contains(StringField);
  @field friend = linksTo(Person);
  @field pets = linksToMany(Pet);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PetPersonField) {
      return `${this.firstName} Pet Person`;
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: () => 'A person with pets',
  });
  @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
  static fitted = class Fitted extends Component<typeof this> {
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
