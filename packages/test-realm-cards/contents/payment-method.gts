import { contains, field, FieldDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Payment } from './payment';

export class PaymentMethod extends FieldDef {
  @field type = contains(StringField);
  @field payment = contains(Payment);
}
