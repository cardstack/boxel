import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import PowerCalendarRange from 'ember-power-calendar/components/power-calendar-range';
import { type TPowerCalendarRangeOnSelect } from 'ember-power-calendar/components/power-calendar-range';
import powerCalendarFormatDate from 'ember-power-calendar/helpers/power-calendar-format-date';
import {
  type SelectedPowerCalendarRange,
  add,
} from 'ember-power-calendar/utils';

import TriangleLeftIcon from '../../icons/triangle-left.gts';
import TriangleRightIcon from '../../icons/triangle-right.gts';
import IconButton from '../icon-button/index.gts';

interface Signature {
  Args: {
    end?: Date | null;
    onSelect: TPowerCalendarRangeOnSelect;
    selected?: SelectedPowerCalendarRange;
    start?: Date | null;
  };
  Element: HTMLElement;
}

export default class DateRangePicker extends Component<Signature> {
  @tracked leftCenter: Date;
  @tracked rightCenter: Date;

  constructor(owner: any, args: any) {
    super(owner, args);
    // If both start and end are provided, use them
    if (this.args.start && this.args.end) {
      this.leftCenter = this.args.start;
      this.rightCenter = this.args.end;
    }
    // If only start is provided, set right center to next month
    else if (this.args.start) {
      this.leftCenter = this.args.start;
      this.rightCenter = add(this.args.start, 1, 'month');
    }
    // If only end is provided, set left center to previous month
    else if (this.args.end) {
      this.rightCenter = this.args.end;
      this.leftCenter = add(this.args.end, -1, 'month');
    }
    // If neither is provided, use current date and next month
    else {
      const today = new Date();
      this.leftCenter = today;
      this.rightCenter = add(today, 1, 'month');
    }
  }

  @action
  onNavigate(side: 'left' | 'right', direction: 'previous' | 'next') {
    const months = direction === 'next' ? 1 : -1;

    if (side === 'left') {
      const newLeftCenter = add(this.leftCenter, months, 'month');
      this.leftCenter = newLeftCenter;

      // If left month would overlap with right month, push right month forward
      if (newLeftCenter >= this.rightCenter) {
        this.rightCenter = add(newLeftCenter, 1, 'month');
      }
    } else {
      const newRightCenter = add(this.rightCenter, months, 'month');
      this.rightCenter = newRightCenter;

      // If right month would overlap with left month, push left month backward
      if (newRightCenter <= this.leftCenter) {
        this.leftCenter = add(newRightCenter, -1, 'month');
      }
    }
  }

  <template>
    <div class='date-range-picker'>
      <PowerCalendarRange
        @selected={{@selected}}
        @onSelect={{@onSelect}}
        @locale='en-US'
        ...attributes
        as |calendar|
      >
        <div class='months-container'>
          <div>
            <calendar.Nav aria-label='Left Calendar'>
              <div class='nav-container'>
                <IconButton
                  @icon={{TriangleLeftIcon}}
                  aria-label='Previous month'
                  {{on 'click' (fn this.onNavigate 'left' 'previous')}}
                />
                <div class='month-name'>
                  {{powerCalendarFormatDate
                    this.leftCenter
                    'MMMM yyyy'
                    locale=calendar.locale
                  }}
                </div>
                <IconButton
                  @icon={{TriangleRightIcon}}
                  aria-label='Next month'
                  {{on 'click' (fn this.onNavigate 'left' 'next')}}
                />
              </div>
            </calendar.Nav>
            <calendar.Days @center={{this.leftCenter}} />
          </div>

          <div>
            <calendar.Navi aria-label="Right Calendar">
              <div class='nav-container'>
                <IconButton
                  @icon={{TriangleLeftIcon}}
                  aria-label='Previous month'
                  {{on 'click' (fn this.onNavigate 'right' 'previous')}}
                />
                <div class='month-name'>
                  {{powerCalendarFormatDate
                    this.rightCenter
                    'MMMM yyyy'
                    locale=calendar.locale
                  }}
                </div>
                <IconButton
                  @icon={{TriangleRightIcon}}
                  aria-label='Next month'
                  {{on 'click' (fn this.onNavigate 'right' 'next')}}
                />
              </div>
            </calendar.Nav>
            <calendar.Days @center={{this.rightCenter}} />
          </div>
        </div>
      </PowerCalendarRange>
    </div>
    <style scoped>
      .date-range-picker {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .month-name {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .months-container {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: var(--boxel-sp-lg);
      }
      .nav-container {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      .ember-power-calendar-day {
        width: 2.5em; /*add fixed width to ensure cols of numbers align*/
        padding: var(--boxel-sp-xxs);
      }
      .ember-power-calendar-week {
        gap: var(--boxel-sp-xxs);
      }
    </style>





  </template>
}
