import { field, contains } from 'https://cardstack.com/base/card-api';
import { Contact } from './contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import { StatusTagField } from './contact';

export class Customer extends Contact {
  static displayName = 'CRM Customer';
  static icon = HeartHandshakeIcon;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Customer) {
      return new StatusTagField({
        index: 0,
        label: 'Customer',
        lightColor: '#8bff98',
        darkColor: '#01d818',
      });
    },
  });
}
