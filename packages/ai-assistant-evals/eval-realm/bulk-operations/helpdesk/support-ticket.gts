import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import EmailField from '@cardstack/base/email';
import enumField from '@cardstack/base/enum';
import StringField from '@cardstack/base/string';

export class Agent extends CardDef {
  static displayName = 'Agent';
  @field fullName = contains(StringField);
  @field email = contains(EmailField);
  @field team = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Agent) {
      return this.fullName ?? 'Unnamed agent';
    },
  });
}

export const TicketStatusField = enumField(StringField, {
  options: [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
  ],
});

export class SupportTicket extends CardDef {
  static displayName = 'Support Ticket';
  @field subject = contains(StringField);
  @field requester = contains(StringField);
  @field status = contains(TicketStatusField);
  @field openedOn = contains(DateField);
  @field assignee = linksTo(() => Agent);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SupportTicket) {
      return this.subject ?? 'Untitled ticket';
    },
  });
}
