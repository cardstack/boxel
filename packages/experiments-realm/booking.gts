import {
  contains,
  containsMany,
  linksToMany,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';
import { Person } from './person';
import CalendarCheck from '@cardstack/boxel-icons/calendar-check';

export class Booking extends CardDef {
  static displayName = 'Booking';
  static icon = CalendarCheck;
  @field cardTitle = contains(StringField);
  @field venue = contains(StringField);
  @field startTime = contains(DateTimeField);
  @field endTime = contains(DateTimeField);
  @field hosts = linksToMany(Person);
  @field sponsors = containsMany(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h2><@fields.cardTitle /></h2>
      <div><@fields.startTime /> to <@fields.endTime /></div>
      <div>Hosted by: <@fields.hosts /></div>
    </template>
  };
}
