import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import EmailField from '@cardstack/base/email';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class Attendee extends CardDef {
  static displayName = 'Attendee';
  @field fullName = contains(StringField);
  @field email = contains(EmailField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Attendee) {
      return this.fullName ?? 'Unnamed attendee';
    },
  });
}

export class Event extends CardDef {
  static displayName = 'Event';
  @field name = contains(StringField);
  @field startsAt = contains(DateTimeField);
  @field venue = contains(StringField);
  @field capacity = contains(NumberField);
  @field host = linksTo(() => Attendee);
  @field confirmed = linksToMany(() => Attendee);
  // In sign-up order: the first entry is next in line.
  @field waitlist = linksToMany(() => Attendee);
  @field spotsLeft = contains(NumberField, {
    computeVia: function (this: Event) {
      return (this.capacity ?? 0) - (this.confirmed?.length ?? 0);
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Event) {
      return this.name ?? 'Untitled event';
    },
  });
}
