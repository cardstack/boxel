import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import CalendarIcon from '@cardstack/boxel-icons/calendar';

class MonthFieldEdit extends Component<typeof MonthField> {
  months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  get monthOptions() {
    return this.months.map((name, index) => ({
      value: index + 1,
      label: name,
    }));
  }

  get selectedMonth() {
    const value = this.args.model?.value;
    return this.monthOptions.find((opt) => opt.value === value) || null;
  }

  @action
  updateValue(option: { value: number; label: string } | null) {
    this.args.model.value = option?.value ?? undefined;
  }

  <template>
    <BoxelSelect
      @options={{this.monthOptions}}
      @selected={{this.selectedMonth}}
      @onChange={{this.updateValue}}
      @placeholder='Select month'
      @dropdownClass='month-dropdown'
      data-test-month-select
      as |option|
    >
      {{option.label}}
    </BoxelSelect>
  </template>
}

export class MonthField extends FieldDef {
  static displayName = 'Month';
  static icon = CalendarIcon;

  @field value = contains(NumberField); // Month value (1-12)

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month set';

      try {
        const monthNum = this.args.model?.value;
        if (typeof monthNum !== 'number' || monthNum < 1 || monthNum > 12)
          return value;

        const date = new Date(2025, monthNum - 1, 1);
        return formatDateTime(date, {
          kind: 'month',
          monthDisplay: 'long',
          fallback: String(value),
        });
      } catch {
        return value;
      }
    }

    <template>
      <div class='month-embedded' data-test-month-embedded>
        <span class='month-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .month-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .month-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month';

      try {
        const monthNum = this.args.model?.value;
        if (typeof monthNum !== 'number' || monthNum < 1 || monthNum > 12)
          return value;

        const date = new Date(2025, monthNum - 1, 1);
        return formatDateTime(date, {
          kind: 'month',
          monthDisplay: 'short',
          fallback: String(value),
        });
      } catch {
        return value;
      }
    }

    <template>
      <span class='month-atom' data-test-month-atom>
        <CalendarIcon class='month-icon' />
        <span class='month-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .month-atom {
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

        .month-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .month-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = MonthFieldEdit;
}

export default MonthField;
