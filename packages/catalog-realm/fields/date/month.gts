import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { add } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import CalendarIcon from '@cardstack/boxel-icons/calendar';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';

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

  @action
  updateValue(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.args.model.value = Number(target.value);
  }

  <template>
    <div class='select-wrapper'>
      <label for='month-select-input' class='sr-only'>Month</label>
      <div class='input-icon'>
        <CalendarIcon class='icon' />
      </div>
      <select
        id='month-select-input'
        value={{@model.value}}
        {{on 'change' this.updateValue}}
        class='datetime-select'
        data-test-month-select
      >
        {{#each this.months as |monthName index|}}
          <option value={{add index 1}}>
            {{monthName}}
          </option>
        {{/each}}
      </select>
      <div class='select-icon'>
        <ChevronDownIcon class='icon' />
      </div>
    </div>

    <style scoped>
      .select-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
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
