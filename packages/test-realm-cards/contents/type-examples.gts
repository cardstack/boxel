import BooleanField from '@cardstack/base/boolean';
import {
  contains,
  containsMany,
  field,
  CardDef,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class TypeExamples extends CardDef {
  static displayName = 'Type Examples';
  @field floatField = contains(NumberField);
  @field intField = contains(NumberField);
  @field stringField = contains(StringField);
  @field dateField = contains(DateField);
  @field dateTimeField = contains(DateTimeField);
  @field booleanField = contains(BooleanField);
  @field stringArrayField = containsMany(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: TypeExamples) {
      return this.constructor.displayName;
    },
  });
}
