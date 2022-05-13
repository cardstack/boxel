import { Component, primitive, serialize, deserialize, Card } from 'runtime-spike/lib/card-api';
import { parse, format } from 'date-fns';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { pick } from './pick';

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
      if (this.args.model == null) {
        return '[no date]';
      }
      return this.args.model ? Format.format(this.args.model) : undefined
    }
  }
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="date" value={{this.formatted}} {{on "input" (pick "target.value" (fn this.parsedValue @set)) }} />
    </template>

    parsedValue(set: Function, date: string) {
      return set(parse(date, 'yyyy-MM-dd', new Date()));
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      let date;
      if (this.args.model instanceof Date) {
        date = this.args.model;
      } else {
        date = parse(this.args.model, 'yyyy-MM-dd', new Date());
      }
      return format(date, 'yyyy-MM-dd');
    }
  }
}
