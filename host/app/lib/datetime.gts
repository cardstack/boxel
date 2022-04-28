import { Component, primitive, serialize, deserialize } from 'runtime-spike/lib/card-api';
import parseISO from 'date-fns/parseISO';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('us-EN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour12: true,
  hour: 'numeric',
  minute: '2-digit',
});

export default class DatetimeCard {
  static [primitive]: Date;
  static [serialize](date: string | Date) {
    if (typeof date === 'string') {
      return date;
    }
    return date.toISOString();
  }
  static [deserialize](date: string | Date) {
    if (date instanceof Date) {
      return date;
    }
    return parseISO(date);
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template><span data-test="datetime">{{this.formatted}}</span></template>
    get formatted() {
      return this.args.model ? Format.format(this.args.model) : undefined
    }
  }
}
