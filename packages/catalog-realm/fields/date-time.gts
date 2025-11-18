import { Component } from 'https://cardstack.com/base/card-api';
import BaseDatetimeField from 'https://cardstack.com/base/datetime';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import { eq } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import { Countdown } from './components/countdown';
import { Timeline } from './components/timeline';
import { TimeAgo } from './components/time-ago';
import { ExpirationWarning } from './components/expiration-warning';

interface DateTimeConfiguration {
  presentation?:
    | 'standard'
    | 'countdown'
    | 'timeAgo'
    | 'timeline'
    | 'expirationWarning';
  preset?: 'tiny' | 'short' | 'medium' | 'long';
  format?: string; // Custom Day.js format string
  countdownOptions?: {
    label?: string;
    showControls?: boolean;
  };
  timeAgoOptions?: {
    eventLabel?: string;
    updateInterval?: number;
  };
  timelineOptions?: {
    eventName?: string;
    status?: 'complete' | 'active' | 'pending';
  };
  expirationOptions?: {
    itemName?: string;
  };
}

export class DatetimeField extends BaseDatetimeField {
  static displayName = 'Date & Time';
  static icon = CalendarEventIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get formatted() {
      return this.displayValue;
    }

    get config(): DateTimeConfiguration | undefined {
      return this.args.configuration as DateTimeConfiguration | undefined;
    }

    get presentationMode() {
      return this.config?.presentation ?? 'standard';
    }

    get datetimeValue() {
      return this.args.model;
    }

    get displayValue() {
      if (!this.datetimeValue) return 'No date/time set';

      try {
        const date = new Date(String(this.datetimeValue));

        const preset = this.config?.preset || 'medium';
        const customFormat = this.config?.format;

        return formatDateTime(date, {
          kind: 'datetime',
          preset: customFormat ? undefined : preset,
          format: customFormat,
          fallback: 'Invalid date/time',
        });
      } catch {
        return String(this.datetimeValue);
      }
    }

    <template>
      {{#if (eq this.presentationMode 'countdown')}}
        <Countdown @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentationMode 'timeAgo')}}
        <TimeAgo @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentationMode 'timeline')}}
        <Timeline @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentationMode 'expirationWarning')}}
        <ExpirationWarning @model={{@model}} @config={{this.config}} />
      {{else}}
        <div class='datetime-embedded' data-test-datetime-embedded>
          <span class='datetime-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .datetime-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .datetime-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get formatted() {
      return this.displayValue;
    }

    get displayValue() {
      if (!this.args.model) return 'No date/time';

      try {
        const date = new Date(String(this.args.model));
        return formatDateTime(date, {
          kind: 'datetime',
          preset: 'short',
          fallback: 'Invalid date',
        });
      } catch {
        return String(this.args.model);
      }
    }

    <template>
      <span class='datetime-atom' data-test-datetime-atom>
        <CalendarEventIcon class='datetime-icon' />
        <span class='datetime-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .datetime-atom {
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

        .datetime-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .datetime-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export default DatetimeField;
