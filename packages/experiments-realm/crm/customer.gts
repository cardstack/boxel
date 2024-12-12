import {
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Contact } from './contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';

export class Customer extends Contact {
  static displayName = 'CRM Customer';
  @field _computeStatusTag = contains(StringField, {
    computeVia: function (this: Customer) {
      this.statusTag = {
        index: 0,
        label: 'Customer',
        icon: HeartHandshakeIcon,
        lightColor: '#8bff98',
        darkColor: '#01d818',
      };
    },
  });
}
