import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import { eq } from '@cardstack/boxel-ui/helpers';

class YearFieldEdit extends Component<typeof YearField> {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.args.model.value = Number(target.value);
  }

  get years() {
    return Array.from({ length: 20 }, (_, i) => 2015 + i).reverse();
  }

  <template>
    <div class='select-wrapper'>
      <label for='year-select-input' class='sr-only'>Year</label>
      <div class='input-icon'>
        <CalendarEventIcon class='icon' />
      </div>
      <select
        id='year-select-input'
        value={{@model.value}}
        {{on 'change' this.updateValue}}
        class='datetime-select'
        data-test-year-select
      >
        {{#each this.years as |year|}}
          <option
            value={{year}}
            selected={{eq @model.value year}}
          >{{year}}</option>
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

export class YearField extends FieldDef {
  static displayName = 'Year';
  static icon = CalendarEventIcon;

  @field value = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      return this.args.model?.value || 'No year set';
    }

    <template>
      <div class='year-embedded' data-test-year-embedded>
        <span class='year-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .year-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .year-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      return this.args.model?.value || 'No year';
    }

    <template>
      <span class='year-atom' data-test-year-atom>
        <CalendarEventIcon class='year-icon' />
        <span class='year-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .year-atom {
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

        .year-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .year-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = YearFieldEdit;
}

export default YearField;
