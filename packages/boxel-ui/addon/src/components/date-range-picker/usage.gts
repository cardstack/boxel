import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import type {
  NormalizeRangeActionValue,
  SelectedPowerCalendarRange,
} from 'ember-power-calendar/utils';

import DateRangePicker from './index.gts';

export default class DateRangePickerUsage extends Component {
  @tracked range1: SelectedPowerCalendarRange = {
    start: new Date(2024, 10, 1),
    end: new Date(2024, 10, 15),
  };
  @tracked range2: SelectedPowerCalendarRange = {
    start: new Date(2024, 9, 15),
    end: new Date(2024, 12, 15),
  };
  @tracked range3: SelectedPowerCalendarRange | undefined;

  @action
  onSelect1(selected: NormalizeRangeActionValue) {
    this.range1 = selected.date;
  }

  @action
  onSelect2(selected: NormalizeRangeActionValue) {
    this.range2 = selected.date;
  }

  @action
  onSelect3(selected: NormalizeRangeActionValue) {
    this.range3 = selected.date;
  }

  parseDate(date: Date | null | undefined) {
    if (!date) {
      return '';
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return formatter.format(date);
  }

  get range1String() {
    return `${this.parseDate(this.range1.start)} - ${this.parseDate(
      this.range1.end,
    )}`;
  }

  get range2String() {
    return `${this.parseDate(this.range2.start)} - ${this.parseDate(
      this.range2.end,
    )}`;
  }

  get range3String() {
    if (!this.range3) {
      return `No date selected`;
    }
    return `${this.parseDate(this.range3.start)} - ${this.parseDate(
      this.range3.end,
    )}`;
  }

  <template>
    <FreestyleUsage @name='Date Range Picker (within month)'>
      <:example>
        {{this.range1String}}
        <DateRangePicker
          @selected={{this.range1}}
          @onSelect={{this.onSelect1}}
        />
      </:example>
    </FreestyleUsage>
    <FreestyleUsage @name='Date Range Picker (across months)'>
      <:example>
        {{this.range2String}}
        <DateRangePicker
          @selected={{this.range2}}
          @onSelect={{this.onSelect2}}
          @start={{this.range2.start}}
          @end={{this.range2.end}}
        />
      </:example>
    </FreestyleUsage>
    <FreestyleUsage @name='Date Range Picker (no date specified)'>
      <:example>
        {{this.range3String}}
        <DateRangePicker
          @selected={{this.range3}}
          @onSelect={{this.onSelect3}}
        />
      </:example>
    </FreestyleUsage>
  </template>
}
