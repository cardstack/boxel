import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import enumField from '@cardstack/base/enum';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import { Vendor } from './vendor.gts';

export const InvoiceStatusField = enumField(StringField, {
  options: [
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ],
});

export class Invoice extends CardDef {
  static displayName = 'Invoice';
  @field invoiceNumber = contains(StringField);
  @field vendor = linksTo(() => Vendor);
  @field amount = contains(NumberField);
  @field issuedOn = contains(DateField);
  @field dueDate = contains(DateField);
  @field status = contains(InvoiceStatusField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.invoiceNumber ?? 'Untitled invoice';
    },
  });
}
