import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

import { PersonField } from './person';

export class Book extends CardDef {
  @field author = contains(PersonField);
  @field editions = contains(NumberField);
  @field pubDate = contains(DateField);
  @field cardTitle = contains(StringField);
}
