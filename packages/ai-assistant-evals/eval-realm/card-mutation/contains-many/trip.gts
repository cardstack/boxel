import { markDefinition } from '@cardstack/base';
import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import enumField from '@cardstack/base/enum';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';

export class TravelerField extends FieldDef {
  static displayName = 'Traveler';
  @field name = contains(StringField);
  @field email = contains(EmailField);
}

export const StopKindField = markDefinition(
  enumField(StringField, {
    options: ['meal', 'sight', 'transit', 'stay'],
  }),
);

export class ItineraryStop extends FieldDef {
  static displayName = 'Itinerary Stop';
  @field day = contains(NumberField);
  // 24-hour HH:MM
  @field time = contains(StringField);
  @field place = contains(StringField);
  @field kind = contains(StopKindField);
  @field notes = contains(TextAreaField);
}

export class Trip extends CardDef {
  static displayName = 'Trip';
  @field title = contains(StringField);
  @field travelers = containsMany(TravelerField);
  @field stops = containsMany(ItineraryStop);
  @field stopCount = contains(NumberField, {
    computeVia: function (this: Trip) {
      return this.stops?.length ?? 0;
    },
  });
  @field days = contains(NumberField, {
    computeVia: function (this: Trip) {
      return (this.stops ?? []).reduce(
        (max, stop) => Math.max(max, stop.day ?? 0),
        0,
      );
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Trip) {
      return this.title ?? 'Untitled trip';
    },
  });
}
