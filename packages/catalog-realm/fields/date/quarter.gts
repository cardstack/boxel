// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import CalendarStatsIcon from '@cardstack/boxel-icons/calendar-stats'; // ² Calendar stats icon
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down'; // ³ Chevron down icon

class QuarterFieldEdit extends Component<typeof QuarterField> {
  @tracked quarter = 'Q1';
  @tracked year = '2024';

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹⁰ Initialize from model or set defaults
    this.quarter = this.args.model?.quarter || 'Q1';
    this.year = this.args.model?.year || new Date().getFullYear().toString();
  }

  @action
  updateQuarter(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.quarter = target.value;
    this.args.model.quarter = target.value;
  }

  @action
  updateYear(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.year = target.value;
    this.args.model.year = target.value;
  }

  get years() {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, i) =>
      (currentYear - 4 + i).toString(),
    );
  }

  <template>
    <div class='quarter-edit'>
      <div class='quarter-inputs'>
        <div class='select-wrapper quarter-select'>
          <div class='input-icon'>
            <CalendarStatsIcon class='icon' />
          </div>
          <label for='quarter-select-input' class='sr-only'>Quarter</label>
          <select
            id='quarter-select-input'
            value={{this.quarter}}
            {{on 'change' this.updateQuarter}}
            class='quarter-select-input'
            data-test-quarter-select
          >
            <option value='Q1'>Q1 (Jan-Mar)</option>
            <option value='Q2'>Q2 (Apr-Jun)</option>
            <option value='Q3'>Q3 (Jul-Sep)</option>
            <option value='Q4'>Q4 (Oct-Dec)</option>
          </select>
          <div class='select-icon'>
            <ChevronDownIcon class='icon' />
          </div>
        </div>
        <div class='select-wrapper year-select'>
          <label for='quarter-year-select-input' class='sr-only'>Year</label>
          <select
            id='quarter-year-select-input'
            value={{this.year}}
            {{on 'change' this.updateYear}}
            class='quarter-select-input'
            data-test-quarter-year-select
          >
            {{#each this.years as |yearValue|}}
              <option value={{yearValue}}>{{yearValue}}</option>
            {{/each}}
          </select>
          <div class='select-icon'>
            <ChevronDownIcon class='icon' />
          </div>
        </div>
      </div>
      <p class='quarter-display'>Period: {{this.quarter}} {{this.year}}</p>
    </div>

    <style scoped>
      .quarter-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .quarter-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .select-wrapper {
        position: relative;
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

      .quarter-select-input {
        width: 100%;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
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

      .quarter-select .quarter-select-input {
        padding-left: 2.5rem;
      }

      .quarter-select-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .quarter-display {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
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

// ⁴ QuarterField - Independent FieldDef for fiscal/financial quarters
export class QuarterField extends FieldDef {
  static displayName = 'Quarter';
  static icon = CalendarStatsIcon;

  @field quarter = contains(StringField); // ⁵ Quarter value (Q1, Q2, Q3, Q4)
  @field year = contains(StringField); // ⁶ Year value (e.g., "2024")

  // ⁷ Embedded format - formatted quarter display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const quarter = this.args.model?.quarter;
      const year = this.args.model?.year;

      if (!quarter || !year) return 'No quarter set';

      return `${quarter} ${year}`;
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

  // ⁸ Atom format - compact quarter badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const quarter = this.args.model?.quarter;
      const year = this.args.model?.year;

      if (!quarter || !year) return 'No quarter';

      return `${quarter} ${year}`;
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

  // ⁹ Edit format - quarter and year dropdowns
  static edit = QuarterFieldEdit;
}

export default QuarterField;
