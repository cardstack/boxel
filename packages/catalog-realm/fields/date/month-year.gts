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

class MonthYearFieldEdit extends Component<typeof MonthYearField> {
  @action
  updateValue(value: string) {
    this.args.model.value = value;
  }

  <template>
    <BoxelInput
      @type='month'
      @value={{@model.value}}
      @onInput={{this.updateValue}}
      @id='month-year-input'
      data-test-month-year-input
    />
  </template>
}

export class MonthYearField extends FieldDef {
  static displayName = 'Month-Year';
  static icon = CalendarEventIcon;

  @field value = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month-year set';

      try {
        const date = new Date(value + '-01');
        return formatDateTime(date, {
          kind: 'monthYear',
          fallback: value,
        });
      } catch {
        return value;
      }
    }

    <template>
      <div class='month-year-embedded' data-test-month-year-embedded>
        <span class='month-year-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .month-year-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .month-year-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month-year';

      try {
        const date = new Date(value + '-01');
        return formatDateTime(date, {
          kind: 'monthYear',
          fallback: value,
        });
      } catch {
        return value;
      }
    }

    <template>
      <span class='month-year-atom' data-test-month-year-atom>
        <CalendarEventIcon class='month-year-icon' />
        <span class='month-year-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .month-year-atom {
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

        .month-year-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .month-year-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = MonthYearFieldEdit;
}

export default MonthYearField;
