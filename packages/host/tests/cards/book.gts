import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import NumberCard from 'https://cardstack.com/base/number';
import DateCard from 'https://cardstack.com/base/date';
import { Person } from './person';

export class Book extends CardDef {
  @field author = contains(Person);
  @field editions = contains(NumberCard);
  @field pubDate = contains(DateCard);
}
