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
import CalendarStatsIcon from '@cardstack/boxel-icons/calendar-stats';

class QuarterFieldEdit extends Component<typeof QuarterField> {
  @tracked quarter = 1;
  @tracked year = 2024;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.quarter = this.args.model?.quarter || 1;
    this.year = this.args.model?.year || new Date().getFullYear();
  }

  get quarterOptions() {
    return [
      { value: 1, label: 'Q1 (Jan-Mar)' },
      { value: 2, label: 'Q2 (Apr-Jun)' },
      { value: 3, label: 'Q3 (Jul-Sep)' },
      { value: 4, label: 'Q4 (Oct-Dec)' },
    ];
  }

  get selectedQuarter() {
    return (
      this.quarterOptions.find((opt) => opt.value === this.quarter) || null
    );
  }

  get years() {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, i) => currentYear - 4 + i);
  }

  get yearOptions() {
    return this.years.map((year) => ({ value: year, label: String(year) }));
  }

  get selectedYear() {
    return this.yearOptions.find((opt) => opt.value === this.year) || null;
  }

  @action
  updateQuarter(option: { value: number; label: string } | null) {
    this.quarter = option?.value || 1;
    this.args.model.quarter = this.quarter;
  }

  @action
  updateYear(option: { value: number; label: string } | null) {
    this.year = option?.value || new Date().getFullYear();
    this.args.model.year = this.year;
  }

  <template>
    <div class='quarter-inputs'>
      <div class='quarter-dropdown'>
        <BoxelSelect
          @options={{this.quarterOptions}}
          @selected={{this.selectedQuarter}}
          @onChange={{this.updateQuarter}}
          @placeholder='Select quarter'
          @dropdownClass='data-test-quarter-select'
          as |option|
        >
          {{option.label}}
        </BoxelSelect>
      </div>
      <div class='year-dropdown'>
        <BoxelSelect
          @options={{this.yearOptions}}
          @selected={{this.selectedYear}}
          @onChange={{this.updateYear}}
          @placeholder='Select year'
          data-test-quarter-year-select
          as |option|
        >
          {{option.label}}
        </BoxelSelect>
      </div>
    </div>

    <style scoped>
      .quarter-inputs {
        display: flex;
        gap: 0.5rem;
      }

      .quarter-dropdown {
        width: 48%;
        min-width: 6rem;
      }

      .year-dropdown {
        width: 48%;
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class QuarterField extends FieldDef {
  static displayName = 'Quarter';
  static icon = CalendarStatsIcon;

  @field quarter = contains(NumberField);
  @field year = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const quarter = this.args.model?.quarter;
      const year = this.args.model?.year;

      if (!quarter || !year) return 'No quarter set';

      return `Q${quarter} ${year}`;
    }

    <template>
      <div class='quarter-embedded' data-test-quarter-embedded>
        <span class='quarter-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .quarter-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .quarter-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const quarter = this.args.model?.quarter;
      const year = this.args.model?.year;

      if (!quarter || !year) return 'No quarter';

      return `Q${quarter} ${year}`;
    }

    <template>
      <span class='quarter-atom' data-test-quarter-atom>
        <CalendarStatsIcon class='quarter-icon' />
        <span class='quarter-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .quarter-atom {
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

        .quarter-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .quarter-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = QuarterFieldEdit;
}

export default QuarterField;
