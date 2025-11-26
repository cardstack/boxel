import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import CalendarDaysIcon from '@cardstack/boxel-icons/calendar-days';

class DayFieldEdit extends Component<typeof DayField> {
  get dayOptions() {
    return Array.from({ length: 31 }, (_, i) => ({
      value: i + 1,
      label: `${i + 1}`,
    }));
  }

  get selectedDay() {
    const value = this.args.model?.value;
    return this.dayOptions.find((opt) => opt.value === value) || null;
  }

  @action
  updateValue(option: { value: number; label: string } | null) {
    this.args.model.value = option?.value ?? undefined;
  }

  <template>
    <BoxelSelect
      @options={{this.dayOptions}}
      @selected={{this.selectedDay}}
      @onChange={{this.updateValue}}
      @placeholder='Select day (1-31)'
      @dropdownClass='day-dropdown'
      class='day-select'
      data-test-day-select
      as |option|
    >
      {{option.label}}
    </BoxelSelect>

    <style scoped>
      .day-select {
        min-width: 100px;
        width: 100%;
      }
    </style>
  </template>
}

export class DayField extends FieldDef {
  static displayName = 'Day';
  static icon = CalendarDaysIcon;

  @field value = contains(NumberField); // Day value (1-31)

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No day set';

      if (typeof value !== 'number' || value < 1 || value > 31) {
        return String(value);
      }

      const suffix = ['th', 'st', 'nd', 'rd'];
      const v = value % 100;
      return value + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
    }

    <template>
      <div class='day-embedded' data-test-day-embedded>
        <span class='day-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .day-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .day-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No day';

      if (typeof value !== 'number' || value < 1 || value > 31) {
        return String(value);
      }

      // Use same ordinal suffix logic as embedded
      const suffix = ['th', 'st', 'nd', 'rd'];
      const v = value % 100;
      return value + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
    }

    <template>
      <span class='day-atom' data-test-day-atom>
        <CalendarDaysIcon class='day-icon' />
        <span class='day-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .day-atom {
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

        .day-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .day-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = DayFieldEdit;
}

export default DayField;
