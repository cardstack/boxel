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
import { parse, format } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const dateFormat = `yyyy-MM-dd`;

class View extends Component<typeof DateField> {
  <template>
    {{this.formatted}}
  </template>
  get formatted() {
    if (this.args.model == null) {
      return '[no date]';
    }
    return this.args.model ? Format.format(this.args.model) : undefined;
  }
}

export default class DateField extends FieldDef {
  static [primitive] = {
    tsType: Date,
    serializedType: { type: 'string', format: 'date' },
  };
  static [serialize](date: Date) {
    return format(date, dateFormat);
  }
  static displayName = 'Date';

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    date: any,
  ): Promise<BaseInstanceType<T>> {
    if (date == null) {
      return date;
    }
    return parse(date, dateFormat, new Date()) as BaseInstanceType<T>;
  }

  static [queryableValue](date: Date | undefined) {
    if (date) {
      return format(date, dateFormat);
    }
    return undefined;
  }

  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='date'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
      />
    </template>

    parseInput(set: Function, date: string) {
      return set(parse(date, dateFormat, new Date()));
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      return DateField[serialize](this.args.model);
    }
  };
}
