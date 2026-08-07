import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
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
  @tracked disabled = false;
  @tracked disablePastDates = false;

  @action
  onSelect1(selected: NormalizeRangeActionValue) {
    this.range1 = selected.date;
  }

  @action
  toggleDisablePastDates() {
    this.disablePastDates = !this.disablePastDates;
  }

  get minDate(): Date | undefined {
    if (!this.disablePastDates) {
      return undefined;
    }
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
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
    <FreestyleUsage
      @name='Date Range Picker'
      @description='Calendar control for selecting a start and end date as a contiguous range — used for filters, reports, booking flows, and any time-window input.'
    >
      <:example>
        {{this.range1String}}
        <label class='date-range-picker-usage-toggle'>
          <input
            type='checkbox'
            checked={{this.disablePastDates}}
            {{on 'change' this.toggleDisablePastDates}}
          />
          Disable past dates (sets
          <code>@minDate</code>
          to today, booking-calendar style)
        </label>
        <DateRangePicker
          @selected={{this.range1}}
          @onSelect={{this.onSelect1}}
          @minDate={{this.minDate}}
          @disabled={{this.disabled}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='selected'
          @description='The currently selected range ({ start, end }) — drives which days render highlighted'
          @value={{this.range1}}
          @required={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Called with the normalized selection when the user picks days; receives { date: { start, end } }'
          @required={{true}}
        />
        <Args.Object
          @name='start'
          @description='Selected range start date — only used to decide which month the left calendar initially centers on'
          @value={{this.range1.start}}
        />
        <Args.Object
          @name='end'
          @description='Selected range end date — only used to decide which month the right calendar initially centers on'
          @value={{this.range1.end}}
        />
        <Args.Object
          @name='minDate'
          @description='Earliest selectable day; days before it render disabled. Pass today for an Airbnb-style no-past-dates calendar (toggle in the example above)'
          @value={{this.minDate}}
        />
        <Args.Object
          @name='maxDate'
          @description='Latest selectable day; days after it render disabled (e.g. a booking horizon)'
        />
        <Args.Bool
          @name='disabled'
          @description='Disables interaction with the whole control'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .date-range-picker-usage-toggle {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin-block: var(--boxel-sp-sm);
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
