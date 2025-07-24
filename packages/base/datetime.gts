import {
  Component,
  primitive,
  serialize,
  deserialize,
  queryableValue,
  FieldDef,
} from './card-api';
import { format, parseISO } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import { DatetimeSerializer } from '@cardstack/runtime-common';

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

const { datetimeFormat } = DatetimeSerializer;

class View extends Component<typeof DatetimeField> {
  <template>
    {{this.formatted}}
  </template>
  get formatted() {
    if (this.args.model == null) {
      return '[no date-time]';
    }
    return this.args.model ? Format.format(this.args.model) : undefined;
  }
}

export default class DatetimeField extends FieldDef {
  static displayName = 'DateTime';
  static icon = CalendarClockIcon;
  static [primitive]: Date;
  static [serialize] = DatetimeSerializer.serialize;
  static [deserialize] = DatetimeSerializer.deserialize;
  static [queryableValue] = DatetimeSerializer.queryableValue;

  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='datetime-local'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
        @max='9999-12-31T23:59:59'
        @disabled={{not @canEdit}}
        data-test-datetime-field-editor
      />
    </template>

    parseInput(set: Function, date: string) {
      if (!date?.length) {
        return set(null);
      }
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
