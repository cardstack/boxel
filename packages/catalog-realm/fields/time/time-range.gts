// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import ClockIcon from '@cardstack/boxel-icons/clock'; // ² Clock icon
import { TimeField } from '../time'; // ³ Import TimeField

class TimeRangeFieldEdit extends Component<typeof TimeRangeField> {
  @tracked startTime = '';
  @tracked endTime = '';

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹⁰ Initialize from model or set defaults
    this.startTime = this.args.model?.start?.value || '09:00';
    this.endTime = this.args.model?.end?.value || '17:00';
  }

  @action
  updateStart(event: Event) {
    const target = event.target as HTMLInputElement;
    this.startTime = target.value;
    if (!this.args.model.start) {
      this.args.model.start = new TimeField();
    }
    this.args.model.start.value = target.value;
  }

  @action
  updateEnd(event: Event) {
    const target = event.target as HTMLInputElement;
    this.endTime = target.value;
    if (!this.args.model.end) {
      this.args.model.end = new TimeField();
    }
    this.args.model.end.value = target.value;
  }

  get durationMinutes() {
    if (!this.startTime || !this.endTime) return 0;

    try {
      const [startHours, startMins] = this.startTime.split(':').map(Number);
      const [endHours, endMins] = this.endTime.split(':').map(Number);

      const startTotal = startHours * 60 + startMins;
      const endTotal = endHours * 60 + endMins;

      return endTotal - startTotal;
    } catch {
      return 0;
    }
  }

  get durationDisplay() {
    const mins = this.durationMinutes;
    if (mins <= 0) return '';

    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;

    if (hours === 0) return `${minutes} minutes`;
    if (minutes === 0) return `${hours} hours`;
    return `${hours}h ${minutes}m`;
  }

  <template>
    <div class='time-range-edit'>
      <div class='range-inputs'>
        <div class='input-wrapper'>
          <label for='time-range-start' class='input-label'>Start</label>
          <input
            id='time-range-start'
            type='time'
            value={{this.startTime}}
            {{on 'change' this.updateStart}}
            class='time-input'
            data-test-time-range-start
          />
        </div>
        <span class='range-arrow'>→</span>
        <div class='input-wrapper'>
          <label for='time-range-end' class='input-label'>End</label>
          <input
            id='time-range-end'
            type='time'
            value={{this.endTime}}
            {{on 'change' this.updateEnd}}
            class='time-input'
            data-test-time-range-end
          />
        </div>
      </div>
      {{#if this.durationDisplay}}
        <p class='duration-info'>Duration: {{this.durationDisplay}}</p>
      {{/if}}
    </div>

    <style scoped>
      .time-range-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .range-inputs {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
      }

      .input-wrapper {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .input-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        font-weight: 500;
      }

      .time-input {
        width: 100%;
        padding: 0.5rem 0.75rem;
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

      .range-arrow {
        color: var(--muted-foreground, #9ca3af);
        font-size: 1.5rem;
        padding-bottom: 0.5rem;
      }

      .duration-info {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ⁴ TimeRangeField - Independent FieldDef with structured start/end times
export class TimeRangeField extends FieldDef {
  static displayName = 'Time Range';
  static icon = ClockIcon;

  @field start = contains(TimeField); // ⁵ Use TimeField for range start
  @field end = contains(TimeField); // ⁶ Use TimeField for range end

  // ⁷ Embedded format - clean time range display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const start = this.args.model?.start?.value;
      const end = this.args.model?.end?.value;

      if (!start && !end) return 'No time range set';
      if (!start) return `Until ${end}`;
      if (!end) return `From ${start}`;

      return `${start} → ${end}`;
    }

    <template>
      <div class='time-range-embedded' data-test-time-range-embedded>
        <span class='range-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .time-range-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .range-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ⁸ Atom format - compact badge display
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const start = this.args.model?.start?.value;
      const end = this.args.model?.end?.value;

      if (!start && !end) return 'No range';
      if (!start) return `Until ${end}`;
      if (!end) return `From ${start}`;

      return `${start} - ${end}`;
    }

    <template>
      <span class='time-range-atom' data-test-time-range-atom>
        <ClockIcon class='range-icon' />
        <span class='range-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .time-range-atom {
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

        .range-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .range-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ⁹ Edit format - dual time inputs
  static edit = TimeRangeFieldEdit;
}

export default TimeRangeField;
