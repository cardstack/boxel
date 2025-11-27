import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';

import ClockIcon from '@cardstack/boxel-icons/clock';
import { TimeSlots } from './components/time-slots';

interface TimeConfiguration {
  presentation?: 'standard' | 'timeSlots';
  hourCycle?: 'h11' | 'h12' | 'h23' | 'h24';
  timeStyle?: 'short' | 'medium' | 'long';
  timeSlotsOptions?: {
    availableSlots?: string[];
  };
}

class TimeFieldEdit extends Component<typeof TimeField> {
  @action
  updateTime(value: string) {
    this.args.model.value = value;
  }

  <template>
    <BoxelInput
      @type='time'
      @id='time-input'
      @value={{@model.value}}
      @onInput={{this.updateTime}}
      data-test-time-input
    />
  </template>
}

export class TimeField extends FieldDef {
  static displayName = 'Time';
  static icon = ClockIcon;

  @field value = contains(StringField); // Time string (HH:MM format)

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
        const [hours, minutes] = time.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return time;

        const today = new Date();
        today.setHours(hours, minutes, 0, 0);

        const hourCycle = this.config?.hourCycle;
        const timeStyle = this.config?.timeStyle;

        return formatDateTime(today, {
          kind: 'time',
          hour12: hourCycle ? undefined : true, // hour12 conflicts with hourCycle
          hourCycle: hourCycle,
          timeStyle: timeStyle,
          fallback: time,
        });
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
        }

        .time-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const time = this.args.model?.value;
      if (!time) return 'No time';

      try {
        const [hours, minutes] = time.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return time;

        const today = new Date();
        today.setHours(hours, minutes, 0, 0);

        const hourCycle = this.args?.configuration?.hourCycle;
        const timeStyle = this.args?.configuration?.timeStyle;

        return formatDateTime(today, {
          kind: 'time',
          hour12: hourCycle ? undefined : true, // hour12 conflicts with hourCycle
          hourCycle: hourCycle,
          timeStyle: timeStyle,
          fallback: time,
        });
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

  static edit = TimeFieldEdit;
}

export default TimeField;
