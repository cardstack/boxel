import {
  contains,
  field,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import StringCard from 'https://cardstack.com/base/string';

import { PaymentMethod } from './payment-method';

export class Vendor extends CardDef {
  @field name = contains(StringCard);
  @field paymentMethods = containsMany(PaymentMethod);
  @field title = contains(StringCard, {
    computeVia: function (this: Vendor) {
      return this.name;
    },
  });
  @field description = contains(StringCard, { computeVia: () => 'Vendor' });
}
