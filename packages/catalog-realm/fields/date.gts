import { Component } from 'https://cardstack.com/base/card-api';
import BaseDateField from 'https://cardstack.com/base/date';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { eq } from '@cardstack/boxel-ui/helpers';

import { Countdown } from './components/countdown';
import { Timeline } from './components/timeline';
import { Age } from './components/age';

interface DateTimeConfiguration {
  presentation?: 'standard' | 'countdown' | 'timeline' | 'age';
  countdownOptions?: {
    label?: string;
    showControls?: boolean;
  };
  timelineOptions?: {
    eventName?: string;
    status?: 'complete' | 'active' | 'pending';
  };
  ageOptions?: {
    showNextBirthday?: boolean;
  };
}

export class DateField extends BaseDateField {
  static displayName = 'Date';
  static icon = CalendarIcon;

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

    get dateValue() {
      return this.args.model;
    }

    get displayValue() {
      if (!this.dateValue) return 'No date set';

      try {
        const date = new Date(this.dateValue.toString());
        return date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } catch {
        return String(this.dateValue);
      }
    }

    <template>
      {{#if (eq this.presentationMode 'age')}}
        <Age @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentationMode 'timeline')}}
        <Timeline @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentationMode 'countdown')}}
        <Countdown @model={{@model}} @config={{this.config}} />
      {{else}}
        <div class='date-embedded' data-test-date-embedded>
          <span class='date-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .date-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .date-value {
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
      if (!this.args.model) return 'No date';

      try {
        const date = new Date(String(this.args.model));
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      } catch {
        return String(this.args.model);
      }
    }

    <template>
      <span class='date-atom' data-test-date-atom>
        <CalendarIcon class='date-icon' />
        <span class='date-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .date-atom {
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

        .date-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .date-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export default DateField;
