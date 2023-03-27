import {
  contains,
  containsMany,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import DateTimeCard from 'https://cardstack.com/base/datetime';
import { Person } from './person';
import { Post } from './post';

export class Booking extends Card {
  @field title = contains(StringCard);
  @field venue = contains(StringCard);
  @field startTime = contains(DateTimeCard);
  @field endTime = contains(DateTimeCard);
  @field hosts = containsMany(Person);
  @field sponsors = containsMany(StringCard);
  @field posts = containsMany(Post);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h2><@fields.title /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };
}
