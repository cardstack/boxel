import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from 'https://cardstack.com/base/text-area';

export class TestAddressCard extends CardDef {
  @field address = contains(TextAreaCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      TestAddressCard
      <@fields.address />
    </template>
  };
}

export class SpecificTestAddressCard extends TestAddressCard {
  @field country = contains(StringField);
  @field postcode = contains(StringField);
  @field address = contains(TextAreaCard, {
    computeVia: function (this: SpecificTestAddressCard) {
      return this.country + ' ' + this.postcode;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.country />
      <@fields.postcode />
      <@fields.address />
    </template>
  };
}

export class TestContactCard extends CardDef {
  @field address = linksTo(TestAddressCard); //SpecifictestAddress serializeation json @field correctly
}

// you need search to be polymorphic ie searching for base class will return all subclasses
