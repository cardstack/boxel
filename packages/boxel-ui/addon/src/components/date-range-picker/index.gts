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
import { setupDateLibrary } from './setup.gts';

interface Signature {
  Args: {
    end?: Date | null;
    onSelect: TPowerCalendarRangeOnSelect;
    selected?: SelectedPowerCalendarRange;
    start?: Date | null;
  };
  Element: HTMLElement;
}

const dateFormat = 'MMM yyyy';

export default class DateRangePicker extends Component<Signature> {
  @tracked leftCenter: Date;
  @tracked rightCenter: Date;

  constructor(owner: any, args: any) {
    super(owner, args);

    setupDateLibrary();

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
    <PowerCalendarRange
      @selected={{@selected}}
      @onSelect={{@onSelect}}
      @locale='en-US'
      ...attributes
      as |calendar|
    >
      <div class='months-container'>
        <div class='month-calendar'>
          <calendar.Nav>
            <div class='nav-container'>
              <IconButton
                @icon={{TriangleLeftIcon}}
                aria-label='Previous month'
                {{on 'click' (fn this.onNavigate 'left' 'previous')}}
              />
              <div class='month-name'>
                {{powerCalendarFormatDate
                  this.leftCenter
                  dateFormat
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
          <calendar.Days @weekdayFormat='min' @center={{this.leftCenter}} />
        </div>

        <div class='month-calendar'>
          <calendar.Nav>
            <div class='nav-container'>
              <IconButton
                @icon={{TriangleLeftIcon}}
                aria-label='Previous month'
                {{on 'click' (fn this.onNavigate 'right' 'previous')}}
              />
              <div class='month-name'>
                {{powerCalendarFormatDate
                  this.rightCenter
                  dateFormat
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
    <style scoped>
      .month-calendar {
        width: 100%;
      }
      .months-container {
        display: flex;
        flex-direction: row;
        gap: var(--boxel-sp-lg);
      }
      .nav-container {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .days-container {
        margin-top: auto;
      }
    </style>
    {{! 
    Note: I don't think there is any reason why we can't implement scoped styles here unlike ember-power-select which uses wormholes
    but we do so for now to avoid the complexity of maintaining fidelity with the way the ember-power-calendar styles are implemented.
    We do so intentionally to
    - maintain fidelity with the library
    - avoid the complexity of implementing :deep() pseudo-class to styles to be applied
     }}
    {{! template-lint-disable require-scoped-style }}
    <style>
      .ember-power-calendar {
        --ember-power-calendar-cell-size: 35px;
        --ember-power-calendar-row-spacing: var(--boxel-sp-sm);
        width: 100%;
      }
      .ember-power-calendar-week {
        padding-bottom: var(--ember-power-calendar-row-spacing);
      }
      .ember-power-calendar-weekday {
        padding: var(--boxel-sp-4xs);
      }
    </style>
  </template>
}
