import { CardDef, contains, field } from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import StringField from '@cardstack/base/string';
import { PaymentTermsField } from './payment-terms';

export class Customer extends CardDef {
  static displayName = 'Customer';
  @field name = contains(StringField);
  @field billingEmail = contains(EmailField);
  @field paymentTerms = contains(PaymentTermsField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Customer) {
      return this.name ?? 'Unnamed customer';
    },
  });
}
