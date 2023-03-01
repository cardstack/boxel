
import { contains, field, Card, containsMany } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { PaymentMethod } from './payment-method';

export class Vendor extends Card {
  @field name = contains(StringCard);
  @field paymentMethods = containsMany(PaymentMethod);
}