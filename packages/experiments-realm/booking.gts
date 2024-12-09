import {
  contains,
  containsMany,
  linksToMany,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import DateTimeCard from 'https://cardstack.com/base/datetime';
import { Person } from './person';
import CalendarCheck from '@cardstack/boxel-icons/calendar-check';

export class Booking extends CardDef {
  static displayName = 'Booking';
  static icon = CalendarCheck;
  @field title = contains(StringCard);
  @field venue = contains(StringCard);
  @field startTime = contains(DateTimeCard);
  @field endTime = contains(DateTimeCard);
  @field hosts = linksToMany(Person);
  @field sponsors = containsMany(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h2><@fields.title /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };
}
