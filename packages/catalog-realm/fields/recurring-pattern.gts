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
import { fn, array } from '@ember/helper';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';

import DateField from './date';

class RecurringPatternFieldEdit extends Component<
  typeof RecurringPatternField
> {
  @tracked pattern = 'none';
  @tracked startDate: Date | string = '';
  @tracked endDate: Date | string = '';
  @tracked occurrences: number | null = null;
  @tracked interval = 1;
  @tracked daysOfWeekArray: number[] = [];
  @tracked dayOfMonth = 1;
  @tracked monthOfYear = 1;

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

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹⁸ Load from model fields
    this.pattern = this.args.model?.pattern || 'none';
    this.startDate = this.args.model?.startDate || '';
    this.endDate = this.args.model?.endDate || '';
    this.occurrences = this.args.model?.occurrences ?? null;
    this.interval = this.args.model?.interval ?? 1;
    this.dayOfMonth = this.args.model?.dayOfMonth ?? 1;
    this.monthOfYear = this.args.model?.monthOfYear ?? 1;

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
      this.interval = 2;
      const today = new Date().getDay();
      this.daysOfWeekArray = [today];
    } else if (selected.value === 'monthly') {
      this.dayOfMonth = new Date().getDate();
    } else if (selected.value === 'yearly') {
      this.monthOfYear = new Date().getMonth() + 1;
      this.dayOfMonth = new Date().getDate();
    }

    this.saveToModel();
  }

  @action
  updateStartDate(event: Event) {
    const target = event.target as HTMLInputElement;
    this.startDate = target.value;
    this.saveToModel();
  }

  @action
  updateEndDate(event: Event) {
    const target = event.target as HTMLInputElement;
    this.endDate = target.value;
    this.occurrences = null;
    this.saveToModel();
  }

  @action
  updateOccurrences(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    this.occurrences = isNaN(value) ? null : value;
    if (this.occurrences) {
      this.endDate = '';
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
  updateDayOfMonth(event: Event) {
    const target = event.target as HTMLInputElement;
    this.dayOfMonth = parseInt(target.value) || 1;
    this.saveToModel();
  }

  @action
  updateMonthOfYear(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.monthOfYear = parseInt(target.value) || 1;
    this.saveToModel();
  }

  saveToModel() {
    // ¹⁹ Save to individual model fields
    this.args.model.pattern = this.pattern;

    // Convert string dates to Date objects for DateField
    if (this.startDate && this.startDate !== '') {
      if (typeof this.startDate === 'string') {
        const date = new Date(this.startDate);
        if (!isNaN(date.getTime())) {
          this.args.model.startDate = date;
        } else {
          this.args.model.startDate = undefined;
        }
      } else {
        this.args.model.startDate = this.startDate;
      }
    } else {
      this.args.model.startDate = undefined;
    }

    if (this.endDate && this.endDate !== '') {
      if (typeof this.endDate === 'string') {
        const date = new Date(this.endDate);
        if (!isNaN(date.getTime())) {
          this.args.model.endDate = date;
        } else {
          this.args.model.endDate = undefined;
        }
      } else {
        this.args.model.endDate = this.endDate;
      }
    } else {
      this.args.model.endDate = undefined;
    }

    this.args.model.occurrences = this.occurrences ?? undefined;
    this.args.model.interval = this.interval;
    this.args.model.daysOfWeek =
      this.daysOfWeekArray.length > 0
        ? this.daysOfWeekArray.join(',')
        : undefined;
    this.args.model.dayOfMonth = this.dayOfMonth;
    this.args.model.monthOfYear = this.monthOfYear;
  }

  get summary() {
    if (this.pattern === 'none') return 'Does not repeat';

    const parts: string[] = [];

    if (this.interval > 1) {
      parts.push(`Every ${this.interval}`);
    }

    parts.push(this.selectedPattern.label);

    if (this.needsWeekdays && this.daysOfWeekArray.length > 0) {
      const dayNames = this.daysOfWeekArray
        .map((d) => this.weekDays[d].label)
        .join(', ');
      parts.push(`on ${dayNames}`);
    }

    if (this.endDate) {
      try {
        parts.push(
          `until ${new Date(this.endDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`,
        );
      } catch {
        parts.push(`until ${this.endDate}`);
      }
    } else if (this.occurrences) {
      parts.push(`${this.occurrences} times`);
    }

    return parts.join(' ');
  }

  get startDateValue() {
    if (this.startDate instanceof Date) {
      return this.startDate.toISOString().split('T')[0];
    }
    return this.startDate;
  }

  get endDateValue() {
    if (this.endDate instanceof Date) {
      return this.endDate.toISOString().split('T')[0];
    }
    return this.endDate;
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
            <label for='recurring-start-date' class='detail-label'>Starts on</label>
            <input
              id='recurring-start-date'
              type='date'
              value={{this.startDateValue}}
              {{on 'change' this.updateStartDate}}
              class='detail-input'
              data-test-recurring-start
            />
          </div>

          {{! Weekly: Day selection }}
          {{#if this.needsWeekdays}}
            <div class='detail-field'>
              <label class='detail-label'>Repeat on</label>
              <div class='weekday-buttons'>
                {{#each this.weekDays as |day|}}
                  <button
                    type='button'
                    {{on 'click' (fn this.toggleWeekday day.value)}}
                    class='weekday-btn
                      {{if
                        (array this.daysOfWeekArray day.value)
                        "selected"
                        ""
                      }}'
                    data-test-weekday={{day.value}}
                  >
                    {{day.label}}
                  </button>
                {{/each}}
              </div>
            </div>
          {{/if}}

          {{! Monthly: Day of month }}
          {{#if this.needsDayOfMonth}}
            <div class='detail-field'>
              <label for='recurring-day-of-month' class='detail-label'>Day of
                month</label>
              <input
                id='recurring-day-of-month'
                type='number'
                value={{this.dayOfMonth}}
                min='1'
                max='31'
                {{on 'input' this.updateDayOfMonth}}
                class='detail-input'
                data-test-day-of-month
              />
            </div>
          {{/if}}

          {{! Yearly: Month }}
          {{#if this.needsMonthOfYear}}
            <div class='detail-field'>
              <label
                for='recurring-month-of-year'
                class='detail-label'
              >Month</label>
              <select
                id='recurring-month-of-year'
                value={{this.monthOfYear}}
                {{on 'change' this.updateMonthOfYear}}
                class='detail-select'
                data-test-month-of-year
              >
                <option value='1'>January</option>
                <option value='2'>February</option>
                <option value='3'>March</option>
                <option value='4'>April</option>
                <option value='5'>May</option>
                <option value='6'>June</option>
                <option value='7'>July</option>
                <option value='8'>August</option>
                <option value='9'>September</option>
                <option value='10'>October</option>
                <option value='11'>November</option>
                <option value='12'>December</option>
              </select>
            </div>
          {{/if}}

          {{! End Condition }}
          <div class='detail-field'>
            <label class='detail-label'>Ends</label>
            <div class='end-options'>
              <div class='end-option'>
                <label for='recurring-end-date' class='radio-label'>
                  <input
                    id='recurring-end-date-radio'
                    type='radio'
                    name='endType'
                    checked={{if this.endDate true false}}
                    {{on 'change' (fn (mut this.occurrences) null)}}
                  />
                  <span>On date</span>
                </label>
                <input
                  id='recurring-end-date'
                  type='date'
                  value={{this.endDateValue}}
                  {{on 'change' this.updateEndDate}}
                  class='detail-input'
                  disabled={{if this.occurrences true false}}
                  data-test-recurring-end
                />
              </div>
              <div class='end-option'>
                <label for='recurring-occurrences' class='radio-label'>
                  <input
                    id='recurring-occurrences-radio'
                    type='radio'
                    name='endType'
                    checked={{this.occurrences}}
                    {{on 'change' (fn (mut this.endDate) '')}}
                  />
                  <span>After</span>
                </label>
                <div class='occurrence-input'>
                  <input
                    id='recurring-occurrences'
                    type='number'
                    value={{this.occurrences}}
                    min='1'
                    {{on 'input' this.updateOccurrences}}
                    class='detail-input occurrence-number'
                    disabled={{this.endDateValue}}
                    data-test-recurring-occurrences
                  />
                  <span class='occurrence-label'>occurrences</span>
                </div>
              </div>
            </div>
          </div>

          {{! Summary }}
          <div class='recurrence-summary'>
            <svg
              class='summary-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10'></circle>
              <line x1='12' y1='16' x2='12' y2='12'></line>
              <line x1='12' y1='8' x2='12.01' y2='8'></line>
            </svg>
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

      .detail-input,
      .detail-select {
        padding: 0.375rem 0.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.25rem);
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .detail-input:focus,
      .detail-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
      }

      .detail-input:disabled {
        background: var(--muted, #f1f5f9);
        color: var(--muted-foreground, #94a3b8);
        cursor: not-allowed;
      }

      .weekday-buttons {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 0.25rem;
      }

      .weekday-btn {
        padding: 0.375rem;
        font-size: 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.25rem);
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .weekday-btn:hover {
        border-color: var(--primary, #3b82f6);
      }

      .weekday-btn.selected {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #3b82f6);
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

      .radio-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
      }

      .occurrence-input {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .occurrence-number {
        width: 5rem;
      }

      .occurrence-label {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #64748b);
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

// ⁵ RecurringPatternField - Independent FieldDef for event recurrence
export class RecurringPatternField extends FieldDef {
  static displayName = 'Recurring Pattern';
  static icon = CalendarEventIcon;

  @field pattern = contains(StringField); // ⁶ Pattern type (none, daily, weekly, etc.)
  @field startDate = contains(DateField); // ⁷ When recurrence starts
  @field endDate = contains(DateField); // ⁸ When recurrence ends (optional)
  @field occurrences = contains(NumberField); // ⁹ End after N occurrences
  @field interval = contains(NumberField); // ¹⁰ Interval: every N days/weeks/months
  @field daysOfWeek = contains(StringField); // ¹¹ For weekly: comma-separated day numbers
  @field dayOfMonth = contains(NumberField); // ¹² For monthly: day of month (1-31)
  @field monthOfYear = contains(NumberField); // ¹³ For yearly: month (1-12)
  @field customRule = contains(StringField); // ¹⁴ iCal RRULE for advanced patterns

  // ¹⁵ Embedded format - formatted recurrence summary
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

      // Add interval if specified
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

      // Add end condition
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

  // ¹⁶ Atom format - compact recurrence badge
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
