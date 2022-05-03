import { Component, primitive, serialize, deserialize, Card } from 'runtime-spike/lib/card-api';
import { parse, format } from 'date-fns';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('us-EN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export default class DateCard extends Card {
  static [primitive]: Date;
  static [serialize](date: string | Date) {
    if (typeof date === 'string') {
      return date;
    }
    return format(date, 'yyyy-MM-dd');
  }
  static [deserialize](date: string | Date) {
    if (date instanceof Date) {
      return date;
    }
    return parse(date, 'yyyy-MM-dd', new Date());
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{this.formatted}}</template>
    get formatted() {
      return this.args.model ? Format.format(this.args.model) : undefined
    }
  }
}