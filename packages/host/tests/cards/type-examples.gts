import {
  contains,
  containsMany,
  field,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import DateTimeField from 'https://cardstack.com/base/datetime';
import BooleanField from 'https://cardstack.com/base/boolean';

export class TypeExamples extends CardDef {
  @field floatField = contains(NumberField);
  @field intField = contains(NumberField);
  @field stringField = contains(StringField);
  @field dateField = contains(DateField);
  @field dateTimeField = contains(DateTimeField);
  @field booleanField = contains(BooleanField);
  @field stringArrayField = containsMany(StringField);
}
