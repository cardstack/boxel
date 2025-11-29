import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { TimeField } from '../time';

class TimeRangeFieldEdit extends Component<typeof TimeRangeField> {
  get durationMinutes() {
    const startTime = this.args.model?.start?.value;
    const endTime = this.args.model?.end?.value;

    if (!startTime || !endTime) return 0;

    try {
      const [startHours, startMins] = startTime.split(':').map(Number);
      const [endHours, endMins] = endTime.split(':').map(Number);

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
          <label class='input-label'>Start</label>
          <@fields.start @format='edit' />
        </div>
        <span class='range-arrow'>→</span>
        <div class='input-wrapper'>
          <label class='input-label'>End</label>
          <@fields.end @format='edit' />
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

export class TimeRangeField extends FieldDef {
  static displayName = 'Time Range';
  static icon = ClockIcon;

  @field start = contains(TimeField);
  @field end = contains(TimeField);

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
        }

        .range-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

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

  static edit = TimeRangeFieldEdit;
}

export default TimeRangeField;
