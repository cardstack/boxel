import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';

class WeekFieldEdit extends Component<typeof WeekField> {
  @action
  updateValue(value: string) {
    this.args.model.value = value;
  }

  <template>
    <BoxelInput
      @type='week'
      @value={{@model.value}}
      @onInput={{this.updateValue}}
      @id='week-input'
      data-test-week-input
    />
  </template>
}

export class WeekField extends FieldDef {
  static displayName = 'Week';
  static icon = CalendarEventIcon;

  @field value = contains(StringField); // Week value (YYYY-Www format)

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No week set';

      try {
        const [year, week] = value.split('-W');
        const date = this.getDateFromWeek(parseInt(year), parseInt(week));

        return formatDateTime(date, {
          kind: 'week',
          weekFormat: 'label',
          fallback: `Week ${week} of ${year}`,
        });
      } catch {
        return value;
      }
    }

    getDateFromWeek(year: number, week: number) {
      const jan4 = new Date(year, 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const weekStart = new Date(jan4);
      weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
      return weekStart;
    }

    <template>
      <div class='week-embedded' data-test-week-embedded>
        <span class='week-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .week-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .week-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No week';

      try {
        const [year, week] = value.split('-W');
        const date = this.getDateFromWeek(parseInt(year), parseInt(week));

        return formatDateTime(date, {
          kind: 'week',
          weekFormat: 'iso',
          fallback: `W${week} ${year}`,
        });
      } catch {
        return value;
      }
    }

    getDateFromWeek(year: number, week: number) {
      const jan4 = new Date(year, 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const weekStart = new Date(jan4);
      weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
      return weekStart;
    }

    <template>
      <span class='week-atom' data-test-week-atom>
        <CalendarEventIcon class='week-icon' />
        <span class='week-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .week-atom {
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

        .week-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .week-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = WeekFieldEdit;
}

export default WeekField;
