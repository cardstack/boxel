import { contains, field, Card } from 'https://cardstack.com/base/card-api';
import NumberCard from 'https://cardstack.com/base/integer';
import DateCard from 'https://cardstack.com/base/date';
import { Person } from './person';

export class Book extends Card {
  @field author = contains(Person);
  @field editions = contains(NumberCard);
  @field pubDate = contains(DateCard);
}
