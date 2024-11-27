import { LooseGooseyField } from '../loosey-goosey';
import { CardDef } from 'https://cardstack.com/base/card-api';

export class ContactType extends LooseGooseyField {
  static values = [
    { index: 0, label: 'Lead' },
    { index: 1, label: 'Customer' },
  ];
}

export class Lead extends Contact {
  static displayName = 'CRM Lead';
}

export class Customer extends Contact {
  static displayName = 'CRM Customer';
}

export class Deal extends CardDef {
  static displayName = 'CRM Deal';
}
