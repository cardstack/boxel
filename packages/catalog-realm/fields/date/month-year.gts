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

// ³ MonthYearField - Independent FieldDef for month-year selection
export class MonthYearField extends FieldDef {
  static displayName = 'Month-Year';
  static icon = CalendarEventIcon;

  @field value = contains(StringField); // ⁴ Month-year value (YYYY-MM format)

  // ⁵ Embedded format - formatted month-year display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month-year set';

      try {
        const date = new Date(value + '-01');
        return date.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
      } catch {
        return value;
      }
    }

    <template>
      <div class='month-year-embedded' data-test-month-year-embedded>
        <span class='month-year-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .month-year-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .month-year-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ⁶ Atom format - compact month-year badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No month-year';

      try {
        const date = new Date(value + '-01');
        return date.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });
      } catch {
        return value;
      }
    }

    <template>
      <span class='month-year-atom' data-test-month-year-atom>
        <CalendarEventIcon class='month-year-icon' />
        <span class='month-year-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .month-year-atom {
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

        .month-year-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .month-year-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ⁷ Edit format - month-year input
  static edit = class Edit extends Component<typeof this> {
    @action
    updateValue(event: Event) {
      const target = event.target as HTMLInputElement;
      this.args.model.value = target.value;
    }

    get displayValue() {
      if (!this.args.model?.value) return '';
      try {
        const date = new Date(this.args.model.value + '-01');
        return date.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
      } catch {
        return '';
      }
    }

    <template>
      <div class='month-year-wrapper'>
        <div class='input-wrapper'>
          <div class='input-icon'>
            <CalendarEventIcon class='icon' />
          </div>
          <input
            type='month'
            value={{@model.value}}
            {{on 'change' this.updateValue}}
            class='datetime-input'
            data-test-month-year-input
          />
        </div>
        {{#if this.displayValue}}
          <p class='display-value'>{{this.displayValue}}</p>
        {{/if}}
      </div>

      <style scoped>
        .month-year-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .input-wrapper {
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

        .icon {
          width: 1.25rem;
          height: 1.25rem;
        }

        .datetime-input {
          width: 100%;
          padding: 0.5rem 0.75rem 0.5rem 2.5rem;
          border: 1px solid var(--border, #e0e0e0);
          border-radius: var(--radius, 0.375rem);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
          background: var(--input, #ffffff);
          transition: all 0.15s ease;
        }

        .datetime-input:focus {
          outline: none;
          border-color: var(--ring, #3b82f6);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .display-value {
          font-size: 0.75rem;
          color: var(--muted-foreground, #9ca3af);
          margin: 0;
        }
      </style>
    </template>
  };
}
