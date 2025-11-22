import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import BaseDateField from 'https://cardstack.com/base/date';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { DateRangePicker } from '@cardstack/boxel-ui/components';

import CalendarStatsIcon from '@cardstack/boxel-icons/calendar-stats';

import { BusinessDays } from '../components/business-days';

interface DateRangeConfiguration {
  presentation?: 'standard' | 'businessDays';
}

class DateRangeFieldEdit extends Component<typeof DateRangeField> {
  @tracked startDate: Date | null = null;
  @tracked endDate: Date | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    try {
      const startValue = this.args.model?.start;
      const endValue = this.args.model?.end;

      if (startValue && endValue) {
        this.startDate = new Date(startValue);
        this.endDate = new Date(endValue);
      } else {
        const today = new Date();
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        this.startDate = today;
        this.endDate = nextWeek;
      }
    } catch {
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      this.startDate = today;
      this.endDate = nextWeek;
    }
  }

  get selectedRange() {
    return {
      start: this.startDate,
      end: this.endDate,
    };
  }

  @action
  onSelect(selected: { date: { start: Date | null; end: Date | null } }) {
    this.startDate = selected.date.start;
    this.endDate = selected.date.end;

    if (selected.date.start && selected.date.end) {
      this.args.model.start = selected.date.start as any;
      this.args.model.end = selected.date.end as any;
    }
  }

  get daysDuration() {
    if (!this.startDate || !this.endDate) return 0;
    return Math.ceil(
      (this.endDate.getTime() - this.startDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );
  }

  <template>
    <div class='date-range-edit'>
      <DateRangePicker
        @selected={{this.selectedRange}}
        @onSelect={{this.onSelect}}
        data-test-date-range-picker
      />
      {{#if (gt this.daysDuration 0)}}
        <p class='duration-info'>Duration: {{this.daysDuration}} days</p>
      {{/if}}
    </div>

    <style scoped>
      .date-range-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .duration-info {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

export class DateRangeField extends FieldDef {
  static displayName = 'Date Range';
  static icon = CalendarStatsIcon;

  @field start = contains(BaseDateField);
  @field end = contains(BaseDateField);

  static embedded = class Embedded extends Component<typeof this> {
    get config(): DateRangeConfiguration | undefined {
      return this.args.configuration as DateRangeConfiguration | undefined;
    }

    get presentationMode() {
      return this.config?.presentation ?? 'standard';
    }

    get displayValue() {
      const start = this.args.model?.start;
      const end = this.args.model?.end;

      if (!start && !end) return 'No date range set';
      if (!start)
        return `Until ${formatDateTime(end, {
          preset: 'long',
        })}`;
      if (!end)
        return `From ${formatDateTime(start, {
          preset: 'long',
        })}`;

      return `${formatDateTime(start, {
        preset: 'long',
      })} → ${formatDateTime(end, {
        preset: 'long',
      })}`;
    }

    <template>
      {{#if (eq this.presentationMode 'businessDays')}}
        <BusinessDays @model={{@model}} @config={{this.config}} />
      {{else}}
        <div class='date-range-embedded' data-test-date-range-embedded>
          <span class='range-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .date-range-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .range-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const start = this.args.model?.start;
      const end = this.args.model?.end;

      if (!start && !end) return 'No range';

      try {
        const formatDate = (dateValue: string | Date) => {
          const date =
            typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
          return formatDateTime(date, {
            preset: 'short',
            fallback: String(dateValue),
          });
        };

        if (!start) return `Until ${formatDate(end!)}`;
        if (!end) return `From ${formatDate(start)}`;

        return `${formatDate(start)} - ${formatDate(end)}`;
      } catch {
        return `${start} - ${end}`;
      }
    }

    <template>
      <span class='date-range-atom' data-test-date-range-atom>
        <CalendarStatsIcon class='range-icon' />
        <span class='range-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .date-range-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.5rem;
          background: var(--primary, #3b82f6);
          color: var(--primary-foreground, #ffffff);
          border-radius: var(--radius, 0.375rem);
          font-size: 0.8125rem;
          font-weight: 500;
        }

        .range-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .range-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = DateRangeFieldEdit;
}

export default DateRangeField;
