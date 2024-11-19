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

  @action
  onSelect1(selected: NormalizeRangeActionValue) {
    this.range1 = selected.date;
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

  <template>
    <FreestyleUsage @name='Date Range Picker'>
      <:example>
        {{this.range1String}}
        <DateRangePicker
          @selected={{this.range1}}
          @onSelect={{this.onSelect1}}
        />
      </:example>
    </FreestyleUsage>
  </template>
}
