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
import { Pet } from './pet';
import { Person } from './person';
import { GridContainer } from '@cardstack/boxel-ui/components';

export class PetNameField extends FieldDef {
  static display = 'Pet Name';
  @field name = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}

export class Nickname extends StringField {
  static displayName = 'Nickname';
}

export class PetPerson extends CardDef {
  static displayName = 'Pet Person';
  @field firstName = contains(StringField);
  @field nickname = contains(Nickname);
  @field petName = contains(PetNameField);
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
}
