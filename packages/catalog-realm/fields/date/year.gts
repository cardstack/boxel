// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event'; // ² Calendar event icon
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down'; // ³ Chevron down icon

// ⁴ YearField - Independent FieldDef for year-only selection
export class YearField extends FieldDef {
  static displayName = 'Year';
  static icon = CalendarEventIcon;

  @field value = contains(StringField); // ⁵ Year value (e.g., "2024")

  // ⁶ Embedded format - formatted year display
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

  // ⁷ Atom format - compact year badge
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

  // ⁸ Edit format - year dropdown
  static edit = class Edit extends Component<typeof this> {
    @action
    updateValue(event: Event) {
      const target = event.target as HTMLSelectElement;
      this.args.model.value = target.value;
    }

    get years() {
      return Array.from({ length: 20 }, (_, i) => 2015 + i).reverse();
    }

    <template>
      <div class='select-wrapper'>
        <div class='input-icon'>
          <CalendarEventIcon class='icon' />
        </div>
        <select
          value={{@model.value}}
          {{on 'change' this.updateValue}}
          class='datetime-select'
          data-test-year-select
        >
          {{#each this.years as |year|}}
            <option value={{year}}>{{year}}</option>
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
      </style>
    </template>
  };
}
