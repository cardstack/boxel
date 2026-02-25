import { contains, field, CardDef } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import StringField from '@cardstack/base/string';

export class Event extends CardDef {
  @field cardTitle = contains(StringField);
  @field venue = contains(StringField);
  @field date = contains(DateField);
}
