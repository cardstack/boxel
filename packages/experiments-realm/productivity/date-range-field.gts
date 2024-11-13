import DateField from 'https://cardstack.com/base/date';
import {
  FieldDef,
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import {
  DateRangePicker,
  BoxelDropdown,
  Pill,
} from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

class Edit extends Component<typeof DateRangeField> {
  @tracked range: any | undefined;
  get formatted() {
    if (!this.args.model.start || !this.args.model.end) {
      return '[no date range]';
    }
    let start = Format.format(this.args.model.start);
    let end = Format.format(this.args.model.end);
    return `${start} - ${end}`;
  }

  @action onSelect(selected: any) {
    this.range = selected.date;
  }

  get selected() {
    if (this.args.model.start && this.args.model.end) {
      return this.args.model;
    }
    return this.range;
  }

  @action onClose() {
    this.args.model.start = this.range.start;
    this.args.model.end = this.range.end;
  }

  <template>
    <BoxelDropdown @onClose={{this.onClose}}>
      <:trigger as |bindings|>
        <Pill {{bindings}} @kind='button'>
          {{this.formatted}}
        </Pill>
      </:trigger>
      <:content as |dd|>
        <DateRangePicker
          @start={{this.selected.start}}
          @end={{this.selected.end}}
          @onSelect={{this.onSelect}}
          @selected={{this.selected}}
        />
        <button {{on 'click' dd.close}}>Close</button>
      </:content>
    </BoxelDropdown>
  </template>
}

export default class DateRangeField extends FieldDef {
  static displayName = 'Date Range';
  @field start = contains(DateField);
  @field end = contains(DateField);
  @field title = contains(StringField, {
    computeVia: function (this: DateRangeField) {
      return 'Date Range';
    },
  });

  static edit = Edit;
}
