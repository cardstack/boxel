import { contains, field, FieldDef } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Payment } from './payment';

export class PaymentMethod extends FieldDef {
  @field type = contains(StringCard);
  @field payment = contains(Payment);
}
