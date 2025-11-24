import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import GiftIcon from '@cardstack/boxel-icons/gift';

class MonthDayFieldEdit extends Component<typeof MonthDayField> {
  @tracked month = 1;
  @tracked day = 1;

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

  constructor(owner: any, args: any) {
    super(owner, args);
    this.month = this.args.model?.month || 1;
    this.day = this.args.model?.day || 1;
  }

  get monthOptions() {
    return this.months.map((name, index) => ({
      value: index + 1,
      label: name,
    }));
  }

  get selectedMonth() {
    return this.monthOptions.find((opt) => opt.value === this.month) || null;
  }

  get dayOptions() {
    return Array.from({ length: 31 }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
  }

  get selectedDay() {
    return this.dayOptions.find((opt) => opt.value === this.day) || null;
  }

  @action
  updateMonth(option: { value: number; label: string } | null) {
    this.month = option?.value || 1;
    this.args.model.month = this.month;
  }

  @action
  updateDay(option: { value: number; label: string } | null) {
    this.day = option?.value || 1;
    this.args.model.day = this.day;
  }

  <template>
    <div class='month-day-inputs'>
      <div class='month-select'>
        <BoxelSelect
          @options={{this.monthOptions}}
          @selected={{this.selectedMonth}}
          @onChange={{this.updateMonth}}
          @placeholder='Select month'
          @dropdownClass='month-dropdown'
          data-test-month-select
          as |option|
        >
          {{option.label}}
        </BoxelSelect>
      </div>

      <div class='day-select'>
        <BoxelSelect
          @options={{this.dayOptions}}
          @selected={{this.selectedDay}}
          @onChange={{this.updateDay}}
          @placeholder='Day'
          @dropdownClass='day-dropdown'
          data-test-day-select
          as |option|
        >
          {{option.label}}
        </BoxelSelect>
      </div>
    </div>

    <style scoped>
      .month-day-inputs {
        display: flex;
        gap: 0.5rem;
      }

      .month-select {
        flex: 1;
      }

      .day-select {
        width: 6rem;
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class MonthDayField extends FieldDef {
  static displayName = 'Month-Day';
  static icon = GiftIcon;

  @field month = contains(NumberField); // ⁶ Month component (1-12)
  @field day = contains(NumberField); // ⁷ Day component (1-31)

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const month = this.args.model?.month;
      const day = this.args.model?.day;

      if (!month || !day) return 'No birthday set';

      try {
        const months = [
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
        const monthName = months[month - 1];
        return `${monthName} ${day}`;
      } catch {
        return `${month}-${day}`;
      }
    }

    <template>
      <div class='month-day-embedded' data-test-month-day-embedded>
        <span class='month-day-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .month-day-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .month-day-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const month = this.args.model?.month;
      const day = this.args.model?.day;

      if (!month || !day) return 'No date';

      try {
        const months = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        const monthName = months[month - 1];
        return `${monthName} ${day}`;
      } catch {
        return `${month}-${day}`;
      }
    }

    <template>
      <span class='month-day-atom' data-test-month-day-atom>
        <GiftIcon class='month-day-icon' />
        <span class='month-day-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .month-day-atom {
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

        .month-day-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .month-day-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = MonthDayFieldEdit;
}

export default MonthDayField;
