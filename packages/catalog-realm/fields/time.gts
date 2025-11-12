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
import { eq } from '@cardstack/boxel-ui/helpers'; // ² Helpers
import ClockIcon from '@cardstack/boxel-icons/clock'; // ³ Clock icon
import { TimeSlots } from './components/time-slots'; // ⁴ Import TimeSlots component

// Configuration interface
interface TimeConfiguration {
  // ⁵ Configuration type
  presentation?: 'standard' | 'timeSlots';
  timeSlotsOptions?: {
    availableSlots?: string[];
  };
}

class TimeFieldEdit extends Component<typeof TimeField> {
  @tracked timeValue = '';

  constructor(owner: any, args: any) {
    super(owner, args);
    this.timeValue = this.args.model?.value || '09:00';
  }

  @action
  updateTime(event: Event) {
    const target = event.target as HTMLInputElement;
    this.timeValue = target.value;
    this.args.model.value = target.value;
  }

  <template>
    <div class='time-edit'>
      <div class='input-wrapper'>
        <label for='time-input' class='sr-only'>Time</label>
        <div class='input-icon'>
          <ClockIcon class='icon' />
        </div>
        <input
          id='time-input'
          type='time'
          value={{this.timeValue}}
          {{on 'change' this.updateTime}}
          class='time-input'
          data-test-time-input
        />
      </div>
    </div>

    <style scoped>
      .time-edit {
        width: 100%;
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

      .time-input {
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

      .time-input:focus {
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

// ⁶ TimeField - Independent FieldDef for single time values with presentation support
export class TimeField extends FieldDef {
  static displayName = 'Time';
  static icon = ClockIcon;

  @field value = contains(StringField); // ⁸ Time string (HH:MM format)

  // ⁹ Embedded format - routes to presentation or displays value
  static embedded = class Embedded extends Component<typeof this> {
    get config(): TimeConfiguration | undefined {
      return this.args.configuration as TimeConfiguration | undefined;
    }

    get presentationMode() {
      return this.config?.presentation ?? 'standard';
    }

    get displayValue() {
      const time = this.args.model?.value;
      if (!time) return 'No time set';

      try {
        // ¹⁰ Handle both 24-hour (HH:MM) and 12-hour (HH:MM AM/PM) formats
        let hours: number;
        let minutes: number;

        if (time.includes('AM') || time.includes('PM')) {
          // Parse 12-hour format: "02:00 PM"
          const isPM = time.includes('PM');
          const timeOnly = time.replace(/\s*(AM|PM)/i, '').trim();
          const [h, m] = timeOnly.split(':').map(Number);

          if (isNaN(h) || isNaN(m)) {
            return time; // Return as-is if invalid
          }

          // Convert to 24-hour
          hours = isPM ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
          minutes = m;
        } else {
          // Parse 24-hour format: "14:00"
          const parts = time.split(':').map(Number);
          if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
            return time; // Return as-is if invalid
          }
          [hours, minutes] = parts;
        }

        // Display in 12-hour format
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes
          .toString()
          .padStart(2, '0')} ${period}`;
      } catch {
        return time;
      }
    }

    <template>
      {{#if (eq this.presentationMode 'timeSlots')}}
        <TimeSlots @model={{@model}} @config={{this.config}} />
      {{else}}
        <div class='time-embedded' data-test-time-embedded>
          <span class='time-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .time-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .time-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ¹¹ Atom format - compact time badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const time = this.args.model?.value;
      if (!time) return 'No time';

      try {
        // ¹² Handle both 24-hour (HH:MM) and 12-hour (HH:MM AM/PM) formats
        let hours: number;
        let minutes: number;

        if (time.includes('AM') || time.includes('PM')) {
          // Parse 12-hour format
          const isPM = time.includes('PM');
          const timeOnly = time.replace(/\s*(AM|PM)/i, '').trim();
          const [h, m] = timeOnly.split(':').map(Number);

          if (isNaN(h) || isNaN(m)) {
            return time;
          }

          hours = isPM ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
          minutes = m;
        } else {
          // Parse 24-hour format
          const parts = time.split(':').map(Number);
          if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
            return time;
          }
          [hours, minutes] = parts;
        }

        // Display in 12-hour format
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes
          .toString()
          .padStart(2, '0')} ${period}`;
      } catch {
        return time;
      }
    }

    <template>
      <span class='time-atom' data-test-time-atom>
        <ClockIcon class='time-icon' />
        <span class='time-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .time-atom {
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

        .time-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .time-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ¹³ Edit format - time input
  static edit = TimeFieldEdit;
}

export default TimeField;
