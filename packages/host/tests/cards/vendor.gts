import {
  contains,
  field,
  Card,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import MetadataCard from 'https://cardstack.com/base/metadata';
import StringCard from 'https://cardstack.com/base/string';
import { PaymentMethod } from './payment-method';

export class Vendor extends Card {
  @field name = contains(StringCard);
  @field paymentMethods = containsMany(PaymentMethod);
  @field _metadata = contains(MetadataCard, {
    computeVia: function (this: Vendor) {
      let metadata = new MetadataCard();
      metadata.title = this.name;
      return metadata;
    },
  });
}
