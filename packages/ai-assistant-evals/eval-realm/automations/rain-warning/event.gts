import { CardDef, contains, field } from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import StringField from '@cardstack/base/string';

export class Event extends CardDef {
  static displayName = 'Event';
  @field name = contains(StringField);
  @field city = contains(StringField);
  // The event's day, as YYYY-MM-DD.
  @field date = contains(StringField);
  @field outdoor = contains(BooleanField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Event) {
      return this.name ?? 'Untitled event';
    },
  });
}
