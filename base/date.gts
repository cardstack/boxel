import { Component, primitive, serialize, deserialize, queryableValue, Card, CardInstanceType, CardConstructor } from './card-api';
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

const dateFormat = `yyyy-MM-dd`;

export default class DateCard extends Card {
  static [primitive]: Date;
  static [serialize](date: string | Date) {
    if (typeof date === 'string') {
      return date;
    }
    return format(date, dateFormat);
  }

  static async [deserialize]<T extends CardConstructor>(this: T, date: any): Promise<CardInstanceType<T>> {
    return parse(date, dateFormat, new Date()) as CardInstanceType<T>;
  }

  static [queryableValue](date: Date | undefined) {
    if (date) {
      return format(date, dateFormat);
    }
    return undefined;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>{{this.formatted}}</template>
    get formatted() {
      if (this.args.model == null) {
        return '[no date]';
      }
      return this.args.model ? Format.format(this.args.model) : undefined;
    }
  }

  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="date" value={{this.formatted}} {{on "input" (pick "target.value" (fn this.parseInput @set)) }} />
    </template>

    parseInput(set: Function, date: string) {
      return set(parse(date, dateFormat, new Date()));
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return DateCard[serialize](this.args.model);
    }
  }
}
