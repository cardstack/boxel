import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import StringField from 'https://cardstack.com/base/string';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { not } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import CalendarRangeIcon from '@cardstack/boxel-icons/calendar-range';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';

class TimePeriodFieldEdit extends Component<typeof TimePeriodField> {
  @tracked shouldShowValidation = false;

  @action
  updateLabel(value: string) {
    this.args.model.periodLabel = value;
    // Hide validation while typing
    this.shouldShowValidation = false;
  }

  @action
  handleBlur() {
    // Only show validation after user finishes typing (leaves input)
    this.shouldShowValidation = true;
  }

  get validationMessage() {
    // Don't show validation while user is still typing
    if (!this.shouldShowValidation) return null;

    const label = this.args.model?.periodLabel;
    if (!label || !label.trim()) return null;

    const type = this.args.model?.periodType;
    if (!type) {
      return 'Unrecognized format. Try: Q1 2024, Fall 2024, Week 12, January 2025';
    }

    return null;
  }

  <template>
    <div class='time-period-edit'>
      <BoxelInput
        @value={{@model.periodLabel}}
        @onInput={{this.updateLabel}}
        @onBlur={{this.handleBlur}}
        @placeholder='e.g., Q1, Fall 2024, Week 12, Jan 2025'
        @disabled={{not @canEdit}}
        data-test-time-period-input
      />

      {{#if this.validationMessage}}
        <div class='validation-message'>
          <AlertTriangleIcon class='warning-icon' />
          {{this.validationMessage}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .time-period-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .validation-message {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(251, 146, 60, 0.1);
        border: 1px solid rgba(251, 146, 60, 0.3);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        color: var(--chart3, #fb923c);
      }

      .warning-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class TimePeriodField extends FieldDef {
  static displayName = 'Time Period';
  static icon = CalendarRangeIcon;

  @field periodLabel = contains(StringField);

  @field normalizedLabel = contains(StringField, {
    computeVia: function (this: TimePeriodField) {
      if (!this.periodLabel) return undefined;

      const currentYear = new Date().getFullYear();
      let normalized = this.periodLabel.trim();

      // Add current year to partial inputs
      // "Q1" → "Q1 2025"
      if (/^Q[1-4]$/.test(normalized)) {
        normalized = `${normalized} ${currentYear}`;
      }
      // "Week 12" → "Week 12 2025"
      else if (/^Week ([1-9]|[1-4][0-9]|5[0-3])$/.test(normalized)) {
        normalized = `${normalized} ${currentYear}`;
      }
      // "Wk12" → "Wk12 2025"
      else if (/^Wk([1-9]|[1-4][0-9]|5[0-3])$/.test(normalized)) {
        normalized = `${normalized} ${currentYear}`;
      }
      // "Fall" → "Fall 2025"
      else if (/^(Fall|Spring|Summer)$/.test(normalized)) {
        normalized = `${normalized} ${currentYear}`;
      }
      // Month without year: "January" → "January 2025"
      else if (
        /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)$/.test(
          normalized,
        )
      ) {
        normalized = `${normalized} ${currentYear}`;
      }

      return normalized;
    },
  });

  @field periodType = contains(StringField, {
    computeVia: function (this: TimePeriodField) {
      const label = this.normalizedLabel;
      if (!label) return undefined;

      // Calendar Year: "2024"
      if (/^\d{4}$/.test(label)) {
        return 'Calendar Year';
      }

      // Fiscal Year: "2023-2024" or "2023-24" or "2023 - 2024" (with spaces)
      if (/^\d{4}\s*-\s*(\d{4}|\d{2})$/.test(label)) {
        return 'Fiscal Year';
      }

      // Week: "Week 12 2025" or "2025 Wk12" or "Wk12 2025"
      if (
        /^(Week ([1-9]|[1-4][0-9]|5[0-3]) \d{4}|\d{4} Wk([1-9]|[1-4][0-9]|5[0-3])|Wk([1-9]|[1-4][0-9]|5[0-3]) \d{4})$/.test(
          label,
        )
      ) {
        return 'Week';
      }

      // Quarter: "Q1 2024" or "2024 Q1"
      if (/^(Q[1-4] \d{4}|\d{4} Q[1-4])$/.test(label)) {
        return 'Quarter';
      }

      // Session: "Fall 2024", "Spring 2024", "Summer 2024"
      if (/^(Fall|Spring|Summer) \d{4}$/.test(label)) {
        return 'Session';
      }

      // Session Week: "Wk4 Spring 2025"
      if (
        /^Wk([1-9]|[1-4][0-9]|5[0-3]) (Fall|Spring|Summer) \d{4}$/.test(label)
      ) {
        return 'Session Week';
      }

      // Month: Support various formats
      const monthPattern = new RegExp(
        `^(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?) \\d{4}$`,
      );
      if (monthPattern.test(label)) {
        return 'Month';
      }

      return undefined;
    },
  });

  @field startDate = contains(DateField, {
    computeVia: function (this: TimePeriodField) {
      return this.computeDateRange()?.start;
    },
  });

  @field endDate = contains(DateField, {
    computeVia: function (this: TimePeriodField) {
      return this.computeDateRange()?.end;
    },
  });

  private computeDateRange(): { start: Date; end: Date } | undefined {
    const label = this.normalizedLabel;
    if (!label) return undefined;

    const type = this.periodType;
    if (!type) return undefined;

    switch (type) {
      case 'Calendar Year': {
        const year = parseInt(label);
        return {
          start: new Date(year, 0, 1),
          end: new Date(year, 11, 31),
        };
      }

      case 'Fiscal Year': {
        const [startYearStr, endYearStr] = label.split(/\s*-\s*/);
        const startYear = parseInt(startYearStr.trim());
        const endYearTrimmed = endYearStr.trim();

        let endYear: number;
        if (endYearTrimmed.length === 2) {
          // Handle century boundary: "2099-00" should be 2099-2100
          const startYearCentury = Math.floor(startYear / 100) * 100;
          const startYearTwoDigits = startYear % 100;
          const endYearTwoDigits = parseInt(endYearTrimmed, 10);
          // If end year is less than or equal to start year's last 2 digits, it's in the next century
          if (endYearTwoDigits <= startYearTwoDigits) {
            endYear = startYearCentury + 100 + endYearTwoDigits;
          } else {
            endYear = startYearCentury + endYearTwoDigits;
          }
        } else {
          endYear = parseInt(endYearTrimmed, 10);
        }

        // Validate that end year is after start year
        if (endYear <= startYear) return undefined;

        return {
          start: new Date(startYear, 6, 1), // July 1 (US fiscal year convention)
          end: new Date(endYear, 5, 30), // June 30
        };
      }

      case 'Week': {
        let match = label.match(/Week (\d+) (\d{4})/);
        if (!match) {
          match = label.match(/(\d{4}) Wk(\d+)/);
          if (!match) {
            match = label.match(/Wk(\d+) (\d{4})/);
            if (!match) return undefined;
          } else {
            [match[0], match[2], match[1]] = [match[0], match[1], match[2]];
          }
        }

        const weekNum = parseInt(match[1]);
        const year = parseInt(match[2]);

        // ISO 8601: Week 1 is the week containing January 4
        // Find January 4 of the year
        const jan4 = new Date(year, 0, 4);
        // Find the Monday of the week containing January 4
        const jan4DayOfWeek = jan4.getDay() || 7; // Convert Sunday (0) to 7
        const firstMonday = new Date(jan4);
        firstMonday.setDate(jan4.getDate() - (jan4DayOfWeek - 1));

        // Calculate the start of the requested week
        const startDate = new Date(firstMonday);
        startDate.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        return {
          start: startDate,
          end: endDate,
        };
      }

      case 'Quarter': {
        let match = label.match(/Q(\d) (\d{4})/);
        if (!match) {
          match = label.match(/(\d{4}) Q(\d)/);
          if (!match) return undefined;
          [match[0], match[2], match[1]] = [match[0], match[1], match[2]];
        }
        const quarter = parseInt(match[1]);
        const year = parseInt(match[2]);
        const startMonth = (quarter - 1) * 3;
        return {
          start: new Date(year, startMonth, 1),
          end: new Date(year, startMonth + 3, 0),
        };
      }

      case 'Session': {
        const [session, year] = label.split(' ');
        const numYear = parseInt(year);
        switch (session.toLowerCase()) {
          case 'fall':
            return {
              start: new Date(numYear, 8, 1),
              end: new Date(numYear, 11, 31),
            };
          case 'spring':
            return {
              start: new Date(numYear, 0, 1),
              end: new Date(numYear, 5, 30),
            };
          case 'summer':
            return {
              start: new Date(numYear, 6, 1),
              end: new Date(numYear, 7, 31),
            };
        }
        return undefined;
      }

      case 'Session Week': {
        const match = label.match(/^Wk(\d+) (Fall|Spring|Summer) (\d{4})$/);
        if (!match) return undefined;

        const weekNum = parseInt(match[1]);
        const session = match[2];
        const year = parseInt(match[3]);

        let sessionStart: Date, sessionEnd: Date;
        switch (session.toLowerCase()) {
          case 'fall':
            sessionStart = new Date(year, 8, 1);
            sessionEnd = new Date(year, 11, 31);
            break;
          case 'spring':
            sessionStart = new Date(year, 0, 1);
            sessionEnd = new Date(year, 5, 30);
            break;
          case 'summer':
            sessionStart = new Date(year, 6, 1);
            sessionEnd = new Date(year, 7, 31);
            break;
          default:
            return undefined;
        }

        let firstMonday = new Date(sessionStart);
        while (firstMonday.getDay() !== 1 || firstMonday < sessionStart) {
          firstMonday.setDate(firstMonday.getDate() + 1);
        }

        const startDate = new Date(firstMonday);
        startDate.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        if (startDate > sessionEnd || endDate < sessionStart) {
          return undefined;
        }

        return {
          start: startDate,
          end: endDate,
        };
      }

      case 'Month': {
        const [monthStr, yearStr] = label.split(' ');
        const numYear = parseInt(yearStr);

        const monthMap: Record<string, number> = {
          Jan: 0,
          'Jan.': 0,
          January: 0,
          Feb: 1,
          'Feb.': 1,
          February: 1,
          Mar: 2,
          'Mar.': 2,
          March: 2,
          Apr: 3,
          'Apr.': 3,
          April: 3,
          May: 4,
          Jun: 5,
          'Jun.': 5,
          June: 5,
          Jul: 6,
          'Jul.': 6,
          July: 6,
          Aug: 7,
          'Aug.': 7,
          August: 7,
          Sep: 8,
          'Sep.': 8,
          Sept: 8,
          September: 8,
          Oct: 9,
          'Oct.': 9,
          October: 9,
          Nov: 10,
          'Nov.': 10,
          November: 10,
          Dec: 11,
          'Dec.': 11,
          December: 11,
        };

        const monthIndex = monthMap[monthStr];
        if (monthIndex === undefined) return undefined;

        return {
          start: new Date(numYear, monthIndex, 1),
          end: new Date(numYear, monthIndex + 1, 0),
        };
      }

      default:
        return undefined;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      if (!this.args.model?.periodLabel) {
        return 'No period set';
      }

      const normalized = this.args.model?.normalizedLabel;
      const type = this.args.model?.periodType;

      if (!type || !normalized) {
        return this.args.model.periodLabel;
      }

      const startDate = this.args.model?.startDate;
      const endDate = this.args.model?.endDate;

      if (!startDate || !endDate) {
        return normalized;
      }

      const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year:
            startDate.getFullYear() !== endDate.getFullYear()
              ? 'numeric'
              : undefined,
        });
      };

      // Show normalized label with date range
      return `${normalized} (${formatDate(startDate)} - ${formatDate(
        endDate,
      )})`;
    }

    <template>
      <div class='time-period-embedded' data-test-time-period-embedded>
        <span class='period-value'>{{this.displayValue}}</span>
        {{#if @model.periodType}}
          <span class='period-type-badge'>{{@model.periodType}}</span>
        {{/if}}
      </div>

      <style scoped>
        .time-period-embedded {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .period-value {
          font-weight: 500;
          font-size: 0.875rem;
        }

        .period-type-badge {
          font-size: 0.6875rem;
          padding: 0.125rem 0.5rem;
          background: var(--muted, #f1f5f9);
          color: var(--muted-foreground, #64748b);
          border-radius: 0.25rem;
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      return this.args.model?.periodLabel || 'No period';
    }

    <template>
      <span class='time-period-atom' data-test-time-period-atom>
        <CalendarRangeIcon class='period-icon' />
        <span class='period-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .time-period-atom {
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

        .period-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .period-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = TimePeriodFieldEdit;
}

export default TimePeriodField;
