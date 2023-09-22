import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';

export class PhoneField extends FieldDef {
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);
}

export class EmergencyContactField extends FieldDef {
  @field name = contains(StringField);
  @field phoneNumber = contains(PhoneField);
  @field email = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
      <@fields.phoneNumber />
      <@fields.email />
    </template>
  };
}

class Guest extends FieldDef {
  @field name = contains(StringField);
  @field additionalNames = containsMany(StringField);
}

export class ContactCard extends CardDef {
  static displayName = 'Contact';
  @field name = contains(StringField);
  @field phone = contains(PhoneField);
  @field emergencyContact = contains(EmergencyContactField);
  @field namesInvited = containsMany(StringField);
  @field guest = contains(Guest);
  // @field aliases;
  // @field vendor;
  // @field vendors;
  @field title = contains(StringField, {
    computeVia: function (this: ContactCard) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
      <@fields.phone />
      <@fields.emergencyContact />
      <@fields.namesInvited />
      <@fields.guest />
    </template>
  };
}
