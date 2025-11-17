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
import ClockIcon from '@cardstack/boxel-icons/clock';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

class RelativeTimeFieldEdit extends Component<typeof RelativeTimeField> {
  @tracked amount = 2;
  @tracked unit = 'hours';

  unitOptions = [
    { value: 'minutes', label: 'Minutes' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
    { value: 'months', label: 'Months' },
  ];

  constructor(owner: any, args: any) {
    super(owner, args);
    const modelAmount = this.args.model?.amount;
    const modelUnit = this.args.model?.unit;

    this.amount = modelAmount ?? 2;
    this.unit = modelUnit || 'hours';
  }

  get selectedUnit() {
    return (
      this.unitOptions.find((opt) => opt.value === this.unit) ||
      this.unitOptions[1]
    );
  }

  @action
  updateAmount(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    if (!isNaN(value) && value >= 0) {
      this.amount = value;
      if (this.args.model) {
        this.args.model.amount = value;
      }
    }
  }

  @action
  updateUnit(selected: { value: string; label: string } | null) {
    if (!selected) return;

    if (selected.value !== this.unit) {
      this.unit = selected.value;
      if (this.args.model) {
        this.args.model.unit = selected.value;
      }
    }
  }

  <template>
    <div class='relative-time-edit'>
      <div class='relative-time-inputs'>
        <label for='relative-time-amount' class='sr-only'>Amount</label>
        <input
          id='relative-time-amount'
          type='number'
          value={{this.amount}}
          min='0'
          {{on 'input' this.updateAmount}}
          class='amount-input'
          data-test-relative-amount
        />
        <BoxelSelect
          @selected={{this.selectedUnit}}
          @options={{this.unitOptions}}
          @onChange={{this.updateUnit}}
          class='unit-select'
          data-test-relative-unit
          as |option|
        >
          {{option.label}}
        </BoxelSelect>
      </div>
    </div>

    <style scoped>
      .relative-time-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .relative-time-inputs {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
      }

      .amount-input {
        width: 6rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .amount-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .unit-select {
        flex: 1;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
    </style>
  </template>
}

export class RelativeTimeField extends FieldDef {
  static displayName = 'Relative Time';
  static icon = ClockIcon;

  @field amount = contains(NumberField);
  @field unit = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const amount = this.args.model?.amount;
      const unit = this.args.model?.unit;

      if (amount == null || !unit) return 'No offset set';

      return `In ${amount} ${unit}`;
    }

    <template>
      <div class='relative-time-embedded' data-test-relative-time-embedded>
        <span class='relative-time-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .relative-time-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .relative-time-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const amount = this.args.model?.amount;
      const unit = this.args.model?.unit;

      if (amount == null || !unit) return 'No offset';

      const unitMap: Record<string, string> = {
        minutes: 'min',
        hours: 'hrs',
        days: 'd',
        weeks: 'w',
        months: 'mo',
      };

      const abbrev = unitMap[unit] || unit;
      return `+${amount}${abbrev}`;
    }

    <template>
      <span class='relative-time-atom' data-test-relative-time-atom>
        <ClockIcon class='relative-time-icon' />
        <span class='relative-time-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .relative-time-atom {
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

        .relative-time-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .relative-time-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = RelativeTimeFieldEdit;
}

export default RelativeTimeField;
