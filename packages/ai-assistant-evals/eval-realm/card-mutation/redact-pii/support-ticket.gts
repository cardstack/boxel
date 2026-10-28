import { CardDef, contains, field } from '@cardstack/base/card-api';
import AddressField from '@cardstack/base/address';
import DateField from '@cardstack/base/date';
import EmailField from '@cardstack/base/email';
import enumField from '@cardstack/base/enum';
import MarkdownField from '@cardstack/base/markdown';
import PhoneNumberField from '@cardstack/base/phone-number';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';

export const TicketCategoryField = enumField(StringField, {
  options: ['hardware', 'software', 'billing', 'shipping'],
});

// Each option stores its value; the label is only what the editor shows.
export const TicketStatusField = enumField(StringField, {
  options: [
    { value: 'open', label: 'Open' },
    { value: 'escalated_to_vendor', label: 'Escalated to vendor' },
    { value: 'resolved', label: 'Resolved' },
  ],
});

export class SupportTicket extends CardDef {
  static displayName = 'Support Ticket';
  @field customerName = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field dateOfBirth = contains(DateField);
  @field shippingAddress = contains(AddressField);
  @field accountNumber = contains(StringField);
  @field orderNumber = contains(StringField);
  @field product = contains(StringField);
  @field category = contains(TicketCategoryField);
  @field status = contains(TicketStatusField);
  @field openedOn = contains(DateField);
  @field transcript = contains(MarkdownField);
  @field resolution = contains(TextAreaField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SupportTicket) {
      return `${this.customerName ?? 'Unknown customer'} — ${
        this.product ?? 'Unknown product'
      }`;
    },
  });
}
