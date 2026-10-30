import { contains, field, CardDef } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

import { PersonField } from './person';

export class Book extends CardDef {
  @field author = contains(PersonField);
  @field editions = contains(NumberField);
  @field pubDate = contains(DateField);
  @field cardTitle = contains(StringField);
}
