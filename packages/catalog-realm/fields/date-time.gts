import {
  FieldDef,
  Component,
  primitive,
  serialize,
  queryableValue,
} from 'https://cardstack.com/base/card-api';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not, eq } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import { format, parseISO, isValid } from 'date-fns';

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

// Local datetime format (no timezone)
const localDatetimeFormat = "yyyy-MM-dd'T'HH:mm:ss";

export class DatetimeField extends FieldDef {
  static displayName = 'Date & Time';
  static icon = CalendarEventIcon;
  static [primitive]: Date;

  // Custom serialization to store WITHOUT timezone (local datetime)
  static [serialize](value: Date | null | undefined): string | null {
    if (!value || !(value instanceof Date) || !isValid(value)) {
      return null;
    }
    // Format as local datetime without timezone
    return format(value, localDatetimeFormat);
  }

  // Custom queryable value to store WITHOUT timezone
  static [queryableValue](value: Date | null | undefined): string | null {
    if (!value || !(value instanceof Date) || !isValid(value)) {
      return null;
    }
    // Format as local datetime without timezone
    return format(value, localDatetimeFormat);
  }

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
        const preset = this.args.configuration?.preset || 'short';
        const customFormat = this.args.configuration?.format;
        return formatDateTime(date, {
          kind: 'datetime',
          preset: customFormat ? undefined : preset,
          format: customFormat,
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

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='datetime-local'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
        @max='9999-12-31T23:59:59'
        @disabled={{not @canEdit}}
        data-test-datetime-field-editor
      />
    </template>

    parseInput(set: Function, date: string) {
      if (!date?.length) {
        return set(null);
      }
      let parsed = parseISO(date);
      if (!isValid(parsed)) {
        return;
      }
      return set(parsed);
    }

    get formatted() {
      if (!this.args.model) {
        return;
      }
      if (!(this.args.model instanceof Date) || !isValid(this.args.model)) {
        return;
      }
      return format(this.args.model, localDatetimeFormat);
    }
  };
}

export default DatetimeField;
