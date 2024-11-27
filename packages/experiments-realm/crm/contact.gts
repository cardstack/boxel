import {
  contains,
  field,
  FieldDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { WebUrl } from 'https://cardstack.com/base/web-url';
import { Address } from '../address';
import { EmailAddress } from 'https://cardstack.com/base/email';
import { PhoneField } from '../phone-number';

export class Contact extends FieldDef {
  // This is not a registered user, rather just a contact
  @field salutation = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field address = contains(Address);
  @field phoneNumber = contains(PhoneField);
  @field email = contains(EmailAddress);
  @field website = contains(WebUrl);

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.salutation, this.firstName, this.lastName]
        .filter(Boolean)
        .join(' ');
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
      <br />(+<@fields.phoneNumber.country />)
      <@fields.phoneNumber.area />-<@fields.phoneNumber.number />
    </template>
  };
}
