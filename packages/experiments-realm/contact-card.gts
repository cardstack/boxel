import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksToMany,
} from 'https://cardstack.com/base/card-api';

class Alias extends CardDef {
  static displayName = 'Alias';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Alias) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}

export class PhoneField extends FieldDef {
  static displayName = 'Phone';
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      (+<@fields.country />) <@fields.area />-<@fields.number />
    </template>
  };
}

export class EmergencyContactField extends FieldDef {
  static displayName = 'Emergency Contact';
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

class Name extends StringField {
  static displayName = 'Name';
}

class Guest extends FieldDef {
  static displayName = 'Guest';
  @field name = contains(StringField);
  @field additionalNames = containsMany(Name);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}

export class ContactCard extends CardDef {
  static displayName = 'Contact';
  @field name = contains(StringField);
  @field phone = contains(PhoneField);
  @field emergencyContact = contains(EmergencyContactField);
  @field guestNames = containsMany(Name);
  @field guest = contains(Guest);
  @field aliases = linksToMany(Alias);
  @field title = contains(StringField, {
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
