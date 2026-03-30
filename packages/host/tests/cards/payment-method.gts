import { contains, field, FieldDef } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { Payment } from './payment';

export class PaymentMethod extends FieldDef {
  @field type = contains(StringField);
  @field payment = contains(Payment);
}
