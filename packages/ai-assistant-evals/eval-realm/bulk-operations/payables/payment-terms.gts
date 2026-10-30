import enumField from '@cardstack/base/enum';
import StringField from '@cardstack/base/string';

// Each option stores its value; the label is only what the editor shows.
export const PaymentTermsField = enumField(StringField, {
  options: [
    { value: 'due_on_receipt', label: 'Due on receipt' },
    { value: 'net_15', label: 'NET 15' },
    { value: 'net_30', label: 'NET 30' },
    { value: 'net_45', label: 'NET 45' },
    { value: 'net_60', label: 'NET 60' },
  ],
});
