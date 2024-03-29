import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import NumberCard from 'https://cardstack.com/base/number';

import { PersonField } from './person';

export class Book extends CardDef {
  @field author = contains(PersonField);
  @field editions = contains(NumberCard);
  @field pubDate = contains(DateCard);
}
