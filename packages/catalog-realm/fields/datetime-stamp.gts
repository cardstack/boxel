import { Component } from 'https://cardstack.com/base/card-api';
import BaseDatetimeField from 'https://cardstack.com/base/datetime';
import ClockAlertIcon from '@cardstack/boxel-icons/clock-alert';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

export class DatetimeStampField extends BaseDatetimeField {
  static displayName = 'DateTime Stamp';
  static icon = ClockAlertIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get formatted() {
      return this.displayValue;
    }

    get displayValue() {
      if (!this.args.model) return 'No timestamp set';

      try {
        const date = new Date(String(this.args.model));

        // Always show with timezone indicator
        return formatDateTime(date, {
          kind: 'datetime',
          preset: 'medium',
          fallback: 'Invalid timestamp',
        });
      } catch {
        return String(this.args.model);
      }
    }

    <template>
      <div class='datetime-stamp-embedded' data-test-datetime-stamp-embedded>
        <span class='datetime-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .datetime-stamp-embedded {
          display: flex;
          align-items: center;
        }

        .datetime-value {
          font-weight: 500;
          font-family: var(--font-mono, 'Courier New', monospace);
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get formatted() {
      return this.displayValue;
    }

    get displayValue() {
      if (!this.args.model) return 'No timestamp';

      try {
        const date = new Date(String(this.args.model));
        return formatDateTime(date, {
          kind: 'datetime',
          preset: 'short',
          fallback: 'Invalid',
        });
      } catch {
        return String(this.args.model);
      }
    }

    <template>
      <span class='datetime-stamp-atom' data-test-datetime-stamp-atom>
        <ClockAlertIcon class='datetime-icon' />
        <span class='datetime-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .datetime-stamp-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.5rem;
          background: var(--destructive, #ef4444);
          color: var(--destructive-foreground, #ffffff);
          border-radius: var(--radius, 0.375rem);
          font-size: 0.8125rem;
          font-weight: 500;
        }

        .datetime-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .datetime-value {
          white-space: nowrap;
          font-family: var(--font-mono, 'Courier New', monospace);
        }
      </style>
    </template>
  };
}

export default DatetimeStampField;
