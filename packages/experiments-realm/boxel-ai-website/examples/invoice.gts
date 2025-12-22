import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class Invoice extends CardDef {
  static displayName = 'Invoice';

  @field invoiceNumber = contains(StringField);
  @field clientName = contains(StringField);
  @field amount = contains(NumberField);
  @field status = contains(StringField);
}
