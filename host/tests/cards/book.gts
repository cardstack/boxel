import { contains, field, Card } from 'https://cardstack.com/base/card-api';
import { Person } from './person';

export class Book extends Card {
  @field author = contains(Person);
}