import {
  contains,
  linksToMany,
  field,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Friends extends Card {
  @field firstName = contains(StringCard);
  @field friends = linksToMany(() => Friends);
}
