import { CardDef, contains, field } from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import StringField from '@cardstack/base/string';
import { PaymentTermsField } from './payment-terms';

export class Vendor extends CardDef {
  static displayName = 'Vendor';
  @field name = contains(StringField);
  @field category = contains(StringField);
  @field city = contains(StringField);
  @field contactEmail = contains(EmailField);
  @field paymentTerms = contains(PaymentTermsField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Vendor) {
      return this.name ?? 'Unnamed vendor';
    },
  });
}
