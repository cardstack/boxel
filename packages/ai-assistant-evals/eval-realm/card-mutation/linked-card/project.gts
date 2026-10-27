import {
  CardDef,
  contains,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import PhoneNumberField from '@cardstack/base/phone-number';
import StringField from '@cardstack/base/string';

export class Contact extends CardDef {
  static displayName = 'Contact';
  @field fullName = contains(StringField);
  @field role = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.fullName ?? 'Unnamed contact';
    },
  });
}

export class Project extends CardDef {
  static displayName = 'Project';
  @field name = contains(StringField);
  @field client = contains(StringField);
  // The client's accounts address, not a person's.
  @field billingEmail = contains(EmailField);
  @field status = contains(StringField);
  @field contacts = linksToMany(() => Contact);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name ?? 'Untitled project';
    },
  });
}
