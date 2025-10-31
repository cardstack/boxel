import { Component, primitive, FieldDef } from './card-api';
import { isValid, parse } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import {
  DateSerializer,
  fieldSerializer,
  getSerializer,
  isValidDate,
} from '@cardstack/runtime-common';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const { dateFormat } = DateSerializer;

class View extends Component<typeof DateField> {
  <template>
    {{this.formatted}}
  </template>
  get formatted() {
    if (this.args.model == null) {
      return '[no date]';
    }
    if (!isValidDate(this.args.model)) {
      return '[invalid date]';
    }
    return Format.format(this.args.model);
  }
}

export default class DateField extends FieldDef {
  static icon = CalendarIcon;
  static [primitive]: Date;
  static [fieldSerializer] = 'date' as const;
  static displayName = 'Date';
  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='date'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
        @max='9999-12-31'
        @disabled={{not @canEdit}}
        data-test-date-field-editor
      />
    </template>

    parseInput(set: Function, date: string) {
      if (!date?.length) {
        return set(null);
      }
      let parsed = parse(date, dateFormat, new Date());
      if (!isValid(parsed)) {
        return;
      }
      return set(parsed);
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      if (!isValidDate(this.args.model)) {
        return;
      }
      return getSerializer(DateField[fieldSerializer]).serialize(
        this.args.model,
      );
    }
  };
}
