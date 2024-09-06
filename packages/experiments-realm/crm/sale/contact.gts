import {
  contains,
  field,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { WebUrl } from 'https://cardstack.com/base/web-url';
import { Address } from '../address';
import NumberField from 'https://cardstack.com/base/number';

class EmailAddress extends FieldDef {
  static displayName = 'EmailAddress';
  @field value = contains(StringField);
  // put some validation logic here
}

export class LabelledPhoneNumeber extends FieldDef {
  labels = [
    { code: 1, displayName: 'home' },
    { code: 2, displayName: 'office' },
  ];
  @field phoneNumber = contains(PhoneField);
  @field label = contains(StringField);
}

class PhoneField extends FieldDef {
  static displayName = 'Phone';
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);
}

export class Contact extends CardDef {
  // This is not a registered user, rather just a contact
  @field salutation = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field address = contains(Address);
  @field phoneNumber = contains(LabelledPhoneNumeber);
  @field email = contains(EmailAddress);
  @field website = contains(WebUrl);

  @field fullName = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.salutation, this.firstName, this.lastName]
        .filter(Boolean)
        .join(' ');
    },
  });

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.salutation, this.firstName, this.lastName]
        .filter(Boolean)
        .join(' ');
    },
  });
}
