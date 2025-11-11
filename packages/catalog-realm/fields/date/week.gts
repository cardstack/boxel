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

class WeekFieldEdit extends Component<typeof WeekField> {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  get weekDisplay() {
    if (!this.args.model?.value) return '';
    const [year, week] = this.args.model.value.split('-W');
    return `Week ${week} of ${year}`;
  }

  <template>
    <div class='week-wrapper'>
      <div class='input-wrapper'>
        <label for='week-input' class='sr-only'>Week</label>
        <div class='input-icon'>
          <CalendarEventIcon class='icon' />
        </div>
        <input
          id='week-input'
          type='week'
          value={{@model.value}}
          {{on 'change' this.updateValue}}
          class='datetime-input'
          data-test-week-input
        />
      </div>
      {{#if this.weekDisplay}}
        <p class='display-value'>{{this.weekDisplay}}</p>
      {{/if}}
    </div>

    <style scoped>
      .week-wrapper {
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

// ³ WeekField - Independent FieldDef for ISO week selection
export class WeekField extends FieldDef {
  static displayName = 'Week';
  static icon = CalendarEventIcon;

  @field value = contains(StringField); // ⁴ Week value (YYYY-Www format)

  // ⁵ Embedded format - formatted week display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No week set';

      try {
        const [year, week] = value.split('-W');
        return `Week ${week} of ${year}`;
      } catch {
        return value;
      }
    }

    <template>
      <div class='week-embedded' data-test-week-embedded>
        <span class='week-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .week-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .week-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ⁶ Atom format - compact week badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const value = this.args.model?.value;
      if (!value) return 'No week';

      try {
        const [year, week] = value.split('-W');
        return `W${week} ${year}`;
      } catch {
        return value;
      }
    }

    <template>
      <span class='week-atom' data-test-week-atom>
        <CalendarEventIcon class='week-icon' />
        <span class='week-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .week-atom {
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

        .week-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .week-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ⁷ Edit format - week input
  static edit = WeekFieldEdit;
}

export default WeekField;
