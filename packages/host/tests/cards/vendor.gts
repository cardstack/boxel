import {
  contains,
  field,
  CardDef,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { PaymentMethod } from './payment-method';

export class Vendor extends CardDef {
  @field name = contains(StringField);
  @field paymentMethods = containsMany(PaymentMethod);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Vendor) {
      return this.name;
    },
  });
  @field cardDescription = contains(StringField, { computeVia: () => 'Vendor' });
}
