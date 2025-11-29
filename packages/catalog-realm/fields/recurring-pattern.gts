import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { BoxelSelect, Pill } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import InfoIcon from '@cardstack/boxel-icons/info';

import DateField from './date';

class RecurringPatternFieldEdit extends Component<
  typeof RecurringPatternField
> {
  @tracked pattern = 'none';
  @tracked daysOfWeekArray: number[] = [];

  patterns = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Mon-Fri)' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom...' },
  ];

  weekDays = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
  ];

  monthOptions = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  constructor(owner: any, args: any) {
    super(owner, args);
    this.pattern = this.args.model?.pattern || 'none';

    // Parse daysOfWeek from comma-separated string
    const daysStr = this.args.model?.daysOfWeek;
    if (daysStr) {
      this.daysOfWeekArray = daysStr
        .split(',')
        .map(Number)
        .filter((n: number) => !isNaN(n));
    }
  }

  get selectedPattern() {
    return (
      this.patterns.find((p) => p.value === this.pattern) || this.patterns[0]
    );
  }

  get needsWeekdays() {
    return this.pattern === 'weekly' || this.pattern === 'biweekly';
  }

  get needsDayOfMonth() {
    return this.pattern === 'monthly';
  }

  get needsMonthOfYear() {
    return this.pattern === 'yearly';
  }

  get selectedMonth() {
    const monthValue = this.args.model?.monthOfYear;
    return (
      this.monthOptions.find((opt) => opt.value === monthValue) ||
      this.monthOptions[0]
    );
  }

  @action
  updatePattern(selected: { value: string; label: string } | null) {
    if (!selected) return;

    this.pattern = selected.value;

    // Set smart defaults based on pattern
    if (selected.value === 'weekdays') {
      this.daysOfWeekArray = [1, 2, 3, 4, 5]; // Mon-Fri
    } else if (selected.value === 'weekly') {
      const today = new Date().getDay();
      this.daysOfWeekArray = [today];
    } else if (selected.value === 'biweekly') {
      this.args.model.interval = 2;
      const today = new Date().getDay();
      this.daysOfWeekArray = [today];
    } else if (selected.value === 'monthly') {
      this.args.model.dayOfMonth = new Date().getDate();
    } else if (selected.value === 'yearly') {
      this.args.model.monthOfYear = new Date().getMonth() + 1;
      this.args.model.dayOfMonth = new Date().getDate();
    }

    this.saveToModel();
  }

  @action
  toggleWeekday(day: number) {
    if (this.daysOfWeekArray.includes(day)) {
      this.daysOfWeekArray = this.daysOfWeekArray.filter((d) => d !== day);
    } else {
      this.daysOfWeekArray = [...this.daysOfWeekArray, day].sort();
    }
    this.saveToModel();
  }

  @action
  updateMonthOfYear(selected: { value: number; label: string } | null) {
    if (!selected) return;
    this.args.model.monthOfYear = selected.value;
    this.saveToModel();
  }

  saveToModel() {
    this.args.model.pattern = this.pattern;
    this.args.model.daysOfWeek =
      this.daysOfWeekArray.length > 0
        ? this.daysOfWeekArray.join(',')
        : undefined;
  }

  isWeekdaySelected = (day: number) => {
    return this.daysOfWeekArray.includes(day);
  };

  get summary() {
    if (this.pattern === 'none') return 'Does not repeat';

    const parts: string[] = [];
    const interval = this.args.model?.interval;
    const endDate = this.args.model?.endDate;
    const occurrences = this.args.model?.occurrences;

    if (interval && interval > 1) {
      parts.push(`Every ${interval}`);
    }

    parts.push(this.selectedPattern.label);

    if (this.needsWeekdays && this.daysOfWeekArray.length > 0) {
      const dayNames = this.daysOfWeekArray
        .map((d) => this.weekDays[d].label)
        .join(', ');
      parts.push(`on ${dayNames}`);
    }

    if (endDate) {
      try {
        parts.push(
          `until ${new Date(endDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`,
        );
      } catch {
        parts.push(`until ${endDate}`);
      }
    } else if (occurrences) {
      parts.push(`${occurrences} times`);
    }

    return parts.join(' ');
  }

  <template>
    <div class='recurring-edit'>
      <label class='input-label'>Repeat Pattern</label>
      <BoxelSelect
        @selected={{this.selectedPattern}}
        @options={{this.patterns}}
        @onChange={{this.updatePattern}}
        class='pattern-select'
        data-test-pattern-select
        as |option|
      >
        <div class='pattern-option'>
          <CalendarEventIcon class='pattern-icon' />
          {{option.label}}
        </div>
      </BoxelSelect>

      {{#if (not (eq this.pattern 'none'))}}
        <div class='recurrence-details'>
          {{! Start Date }}
          <div class='detail-field'>
            <label class='detail-label'>Starts on</label>
            <@fields.startDate @format='edit' />
          </div>

          {{! Weekly: Day selection }}
          {{#if this.needsWeekdays}}
            <div class='detail-field'>
              <label class='detail-label'>Repeat on</label>
              <div class='weekday-pills'>
                {{#each this.weekDays as |day|}}
                  <Pill
                    @kind='button'
                    @variant={{if
                      (this.isWeekdaySelected day.value)
                      'primary'
                      ''
                    }}
                    @size='small'
                    {{on 'click' (fn this.toggleWeekday day.value)}}
                    data-test-weekday={{day.value}}
                  >
                    {{day.label}}
                  </Pill>
                {{/each}}
              </div>
            </div>
          {{/if}}

          {{! Monthly: Day of month }}
          {{#if this.needsDayOfMonth}}
            <div class='detail-field'>
              <label class='detail-label'>Day of month</label>
              <@fields.dayOfMonth @format='edit' />
            </div>
          {{/if}}

          {{! Yearly: Month }}
          {{#if this.needsMonthOfYear}}
            <div class='detail-field'>
              <label class='detail-label'>Month</label>
              <BoxelSelect
                @options={{this.monthOptions}}
                @selected={{this.selectedMonth}}
                @onChange={{this.updateMonthOfYear}}
                @placeholder='Select month'
                data-test-month-of-year
                as |option|
              >
                {{option.label}}
              </BoxelSelect>
            </div>
          {{/if}}

          {{! End Condition }}
          <div class='detail-field'>
            <label class='detail-label'>Ends</label>
            <div class='end-options'>
              <div class='end-option'>
                <label class='end-option-label'>On date</label>
                <@fields.endDate @format='edit' />
              </div>
              <div class='end-option'>
                <label class='end-option-label'>After</label>
                <div class='occurrence-input'>
                  <div class='occurrence-field'>
                    <@fields.occurrences @format='edit' />
                  </div>
                  <span class='occurrence-label'>occurrences</span>
                </div>
              </div>
            </div>
          </div>

          {{! Summary }}
          <div class='recurrence-summary'>
            <InfoIcon class='summary-icon' />
            {{this.summary}}
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .recurring-edit {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .input-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .pattern-select {
        width: 100%;
      }

      .pattern-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .pattern-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary, #3b82f6);
      }

      .recurrence-details {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
      }

      .detail-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .detail-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
      }

      .weekday-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      .end-options {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .end-option {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .end-option-label {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
      }

      .occurrence-input {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
      }

      .occurrence-field {
        width: 6rem;
        flex-shrink: 0;
      }

      .occurrence-label {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #64748b);
        padding-top: 0.5rem;
      }

      .recurrence-summary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(59, 130, 246, 0.1);
        border-left: 3px solid var(--primary, #3b82f6);
        border-radius: var(--radius, 0.25rem);
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
      }

      .summary-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        color: var(--primary, #3b82f6);
      }
    </style>
  </template>
}

export class RecurringPatternField extends FieldDef {
  static displayName = 'Recurring Pattern';
  static icon = CalendarEventIcon;

  @field pattern = contains(StringField); //  Pattern type (none, daily, weekly, etc.)
  @field startDate = contains(DateField); //  When recurrence starts
  @field endDate = contains(DateField); //  When recurrence ends (optional)
  @field occurrences = contains(NumberField); //  End after N occurrences
  @field interval = contains(NumberField); //  Interval: every N days/weeks/months
  @field daysOfWeek = contains(StringField); //  For weekly: comma-separated day numbers
  @field dayOfMonth = contains(NumberField); //  For monthly: day of month (1-31)
  @field monthOfYear = contains(NumberField); //  For yearly: month (1-12)
  @field customRule = contains(StringField); //  iCal RRULE for advanced patterns

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const pattern = this.args.model?.pattern;

      if (!pattern || pattern === 'none') return 'Does not repeat';

      const patternLabels: Record<string, string> = {
        daily: 'Daily',
        weekdays: 'Every weekday (Mon-Fri)',
        weekly: 'Weekly',
        biweekly: 'Every 2 weeks',
        monthly: 'Monthly',
        yearly: 'Yearly',
        custom: 'Custom recurrence',
      };

      let display = patternLabels[pattern] || pattern;

      const interval = this.args.model?.interval;
      if (interval && interval > 1) {
        display = `Every ${interval} ${
          pattern === 'weekly'
            ? 'weeks'
            : pattern === 'monthly'
            ? 'months'
            : 'days'
        }`;
      }

      const endDate = this.args.model?.endDate;
      const occurrences = this.args.model?.occurrences;

      if (endDate) {
        try {
          const formatted = new Date(endDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          display += ` until ${formatted}`;
        } catch {
          display += ` until ${endDate}`;
        }
      } else if (occurrences) {
        display += ` (${occurrences} times)`;
      }

      return display;
    }

    <template>
      <div class='recurring-embedded' data-test-recurring-embedded>
        <span class='recurring-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .recurring-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .recurring-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const pattern = this.args.model?.pattern;

      if (!pattern || pattern === 'none') return 'No repeat';

      const shortLabels: Record<string, string> = {
        daily: 'Daily',
        weekdays: 'Weekdays',
        weekly: 'Weekly',
        biweekly: 'Bi-weekly',
        monthly: 'Monthly',
        yearly: 'Yearly',
        custom: 'Custom',
      };

      return shortLabels[pattern] || pattern;
    }

    <template>
      <span class='recurring-atom' data-test-recurring-atom>
        <CalendarEventIcon class='recurring-icon' />
        <span class='recurring-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .recurring-atom {
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

        .recurring-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .recurring-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = RecurringPatternFieldEdit;
}

export default RecurringPatternField;
