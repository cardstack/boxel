import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

class RelativeTimeFieldEdit extends Component<typeof RelativeTimeField> {
  unitOptions = [
    { value: 'minutes', label: 'Minutes' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
    { value: 'months', label: 'Months' },
  ];

  get selectedUnit() {
    const unit = this.args.model?.unit;
    return (
      this.unitOptions.find((opt) => opt.value === unit) || this.unitOptions[1]
    );
  }

  @action
  updateUnit(selected: { value: string; label: string } | null) {
    if (!selected) return;
    this.args.model.unit = selected.value;
  }

  <template>
    <div class='relative-time-edit'>
      <div class='relative-time-inputs'>
        <div class='amount-field'>
          <@fields.amount @format='edit' />
        </div>
        <BoxelSelect
          @selected={{this.selectedUnit}}
          @options={{this.unitOptions}}
          @onChange={{this.updateUnit}}
          @placeholder='Select unit'
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

      .amount-field {
        width: 6rem;
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
