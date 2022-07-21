import { Component, primitive, serialize, CardInstanceType, CardConstructor, Card } from './card-api';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { pick } from './pick';

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

export default class DatetimeCard extends Card {
  static [primitive]: Date;
  static [serialize](date: string | Date) {
    if (typeof date === 'string') {
      return date;
    }
    return date.toISOString();
  }

  static fromSerialized<T extends CardConstructor>(this: T, date: any): CardInstanceType<T> {
    return parseISO(date) as CardInstanceType<T>;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>{{this.formatted}}</template>
    get formatted() {
      if (this.args.model == null) {
        return '[no date-time]';
      }
      return this.args.model ? Format.format(this.args.model) : undefined;
    }
  }

  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="datetime-local" value={{this.formatted}} {{on "input" (pick "target.value" (fn this.parseInput @set))}} />
    </template>

    parseInput(set: Function, date: string) {
      let deserialized = DatetimeCard.fromSerialized(date);
      return set(deserialized);
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return format(this.args.model, `yyyy-MM-dd'T'HH:mm`);
    }
  }
}
