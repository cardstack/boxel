import {
  contains,
  containsMany,
  linksToMany,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateTimeCard from 'https://cardstack.com/base/datetime';
import { Person } from './person';

export class Booking extends CardDef {
  static displayName = 'Booking';
  @field title = contains(StringField);
  @field venue = contains(StringField);
  @field startTime = contains(DateTimeCard);
  @field endTime = contains(DateTimeCard);
  @field hosts = linksToMany(Person);
  @field sponsors = containsMany(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h2><@fields.title /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };
}
