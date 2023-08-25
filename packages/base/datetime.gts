import {
  Component,
  primitive,
  serialize,
  deserialize,
  queryableValue,
  BaseInstanceType,
  BaseDefConstructor,
  FieldDef,
} from './card-api';
import { format, parseISO } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour12: true,
  hour: 'numeric',
  minute: '2-digit',
});

const datetimeFormat = `yyyy-MM-dd'T'HH:mm`;

export default class DatetimeField extends FieldDef {
  static [primitive]: Date;
  static [serialize](date: Date) {
    return date.toISOString();
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    date: any,
  ): Promise<BaseInstanceType<T>> {
    if (date == null) {
      return date;
    }
    return parseISO(date) as BaseInstanceType<T>;
  }

  static [queryableValue](date: Date | undefined) {
    if (date) {
      return format(date, datetimeFormat);
    }
    return undefined;
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{this.formatted}}
    </template>
    get formatted() {
      if (this.args.model == null) {
        return '[no date-time]';
      }
      return this.args.model ? Format.format(this.args.model) : undefined;
    }
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='datetime-local'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
      />
    </template>

    parseInput(set: Function, date: string) {
      return set(parseISO(date));
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return format(this.args.model, datetimeFormat);
    }
  };
}
