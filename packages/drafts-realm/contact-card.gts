import StringCard from 'https://cardstack.com/base/string';
import NumberCard from 'https://cardstack.com/base/number';
import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';

export class PhoneCard extends FieldDef {
  @field country = contains(NumberCard);
  @field area = contains(NumberCard);
  @field number = contains(NumberCard);
}

export class EmergencyContactCard extends FieldDef {
  @field name = contains(StringCard);
  @field phoneNumber = contains(PhoneCard);
  @field email = contains(StringCard);
}

class Guest extends FieldDef {
  @field name = contains(StringCard);
  @field additionalNames = containsMany(StringCard);
}

export class ContactCard extends CardDef {
  static displayName = 'Contact';
  @field name = contains(StringCard);
  @field phone = contains(PhoneCard);
  @field emergencyContact = contains(EmergencyContactCard);
  @field guest = contains(Guest);
  // @field aliases;
  // @field vendor;
  // @field vendors;
  @field title = contains(StringCard, {
    computeVia: function (this: ContactCard) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
      <@fields.phone />
    </template>
  };
}
