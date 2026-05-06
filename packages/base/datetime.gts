import { Component, primitive, FieldDef } from './card-api';
import GlimmerComponent from '@glimmer/component';
import { format, parseISO, isValid } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not, eq, formatDateTime } from '@cardstack/boxel-ui/helpers';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import {
  fieldSerializer,
  DatetimeSerializer,
  isValidDate,
} from '@cardstack/runtime-common';
import { formatDateTimeForMarkdown } from './markdown-helpers';
import { Countdown } from './components/countdown';
import { Timeline } from './components/timeline';
import { TimeAgo } from './components/time-ago';
import { ExpirationWarning } from './components/expiration-warning';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour12: true,
  hour: 'numeric',
  minute: '2-digit',
});

const { datetimeFormat } = DatetimeSerializer;

interface DateTimeFieldConfiguration {
  presentation?:
    | 'standard'
    | 'countdown'
    | 'timeAgo'
    | 'timeline'
    | 'expirationWarning';
  preset?: 'tiny' | 'short' | 'medium' | 'long';
  format?: string;
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

interface ViewSignature {
  Args: {
    model: Date | null | undefined;
    configuration?: unknown;
  };
}

class View extends GlimmerComponent<ViewSignature> {
  <template>
    {{this.formatted}}
  </template>
  get formatted() {
    if (this.args.model == null) {
      return '[no date-time]';
    }
    if (!isValidDate(this.args.model)) {
      return '[invalid date-time]';
    }
    return Format.format(this.args.model);
  }
}

class EmbeddedView extends GlimmerComponent<ViewSignature> {
  get config(): DateTimeFieldConfiguration | undefined {
    return this.args.configuration as DateTimeFieldConfiguration | undefined;
  }

  get presentationMode() {
    return this.config?.presentation ?? 'standard';
  }

  get displayValue() {
    if (!this.args.model) return 'No date/time set';
    try {
      const date = new Date(String(this.args.model));
      const preset = this.config?.preset || 'medium';
      const customFormat = this.config?.format;
      return formatDateTime(date, {
        kind: 'datetime',
        preset: customFormat ? undefined : preset,
        format: customFormat,
        fallback: 'Invalid date/time',
      });
    } catch {
      return String(this.args.model);
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
    {{else if this.config}}
      <div class='datetime-embedded' data-test-datetime-embedded>
        <span class='datetime-value'>{{this.displayValue}}</span>
      </div>
    {{else}}
      <View @model={{@model}} />
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
}

class AtomView extends GlimmerComponent<ViewSignature> {
  get displayValue() {
    if (!this.args.model) return 'No date/time';
    try {
      const date = new Date(String(this.args.model));
      const config = this.args.configuration as
        | DateTimeFieldConfiguration
        | undefined;
      const preset = config?.preset || 'short';
      const customFormat = config?.format;
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
    {{#if @configuration}}
      <span class='datetime-atom' data-test-datetime-atom>
        <CalendarClockIcon class='datetime-icon' />
        <span class='datetime-value'>{{this.displayValue}}</span>
      </span>
    {{else}}
      <View @model={{@model}} />
    {{/if}}

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
}

export default class DateTimeField extends FieldDef {
  static displayName = 'DateTime';
  static icon = CalendarClockIcon;
  static [primitive]: Date;
  static [fieldSerializer] = 'datetime';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <EmbeddedView @model={{@model}} @configuration={{@configuration}} />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <AtomView @model={{@model}} @configuration={{@configuration}} />
    </template>
  };

  // CS-10786: consistent markdown-escaped date+time output.
  static markdown = class Markdown extends Component<typeof this> {
    get formatted() {
      return formatDateTimeForMarkdown(this.args.model);
    }
    <template>{{this.formatted}}</template>
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
      if (!isValidDate(this.args.model)) {
        return;
      }
      return format(this.args.model, datetimeFormat);
    }
  };
}
