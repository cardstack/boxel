import { Component, primitive, FieldDef } from './card-api';
import GlimmerComponent from '@glimmer/component';
import { isValid, parse } from 'date-fns';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not, eq, formatDateTime } from '@cardstack/boxel-ui/helpers';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import {
  DateSerializer,
  fieldSerializer,
  getSerializer,
  isValidDate,
} from '@cardstack/runtime-common';
import { formatDateForMarkdown } from './markdown-helpers';
import { Countdown } from './components/countdown';
import { Timeline } from './components/timeline';
import { Age } from './components/age';

// The Intl API is supported in all modern browsers. In older ones, we polyfill
// it in the application route at app startup.
const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const { dateFormat } = DateSerializer;

interface DateFieldConfiguration {
  presentation?: 'standard' | 'countdown' | 'timeline' | 'age';
  preset?: 'tiny' | 'short' | 'medium' | 'long';
  format?: string;
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
      return '[no date]';
    }
    if (!isValidDate(this.args.model)) {
      return '[invalid date]';
    }
    return Format.format(this.args.model);
  }
}

class EmbeddedView extends GlimmerComponent<ViewSignature> {
  get config(): DateFieldConfiguration | undefined {
    return this.args.configuration as DateFieldConfiguration | undefined;
  }

  get presentationMode() {
    return this.config?.presentation ?? 'standard';
  }

  get displayValue() {
    if (!this.args.model) return 'No date set';
    try {
      const date = new Date(this.args.model.toString());
      const preset = this.config?.preset || 'long';
      const customFormat = this.config?.format;
      return formatDateTime(date, {
        preset: customFormat ? undefined : preset,
        format: customFormat,
        fallback: 'Invalid date',
      });
    } catch {
      return String(this.args.model);
    }
  }

  <template>
    {{#if (eq this.presentationMode 'age')}}
      <Age @model={{@model}} @config={{this.config}} />
    {{else if (eq this.presentationMode 'timeline')}}
      <Timeline @model={{@model}} @config={{this.config}} />
    {{else if (eq this.presentationMode 'countdown')}}
      <Countdown @model={{@model}} @config={{this.config}} />
    {{else if this.config}}
      <div class='date-embedded' data-test-date-embedded>
        <span class='date-value'>{{this.displayValue}}</span>
      </div>
    {{else}}
      <View @model={{@model}} />
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
}

class AtomView extends GlimmerComponent<ViewSignature> {
  get displayValue() {
    if (!this.args.model) return 'No date';
    try {
      const date = new Date(String(this.args.model));
      const config = this.args.configuration as DateFieldConfiguration | undefined;
      return formatDateTime(date, {
        preset: config?.preset || 'medium',
        fallback: 'Invalid date',
      });
    } catch {
      return String(this.args.model);
    }
  }

  <template>
    {{#if @configuration}}
      <span class='date-atom' data-test-date-atom>
        <CalendarIcon class='date-icon' />
        <span class='date-value'>{{this.displayValue}}</span>
      </span>
    {{else}}
      <View @model={{@model}} />
    {{/if}}

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
}

export default class DateField extends FieldDef {
  static icon = CalendarIcon;
  static [primitive]: Date;
  static [fieldSerializer] = 'date' as const;
  static displayName = 'Date';

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

  // CS-10786: emit a consistently-formatted, markdown-escaped date so the
  // value doesn't introduce accidental formatting when interpolated into a
  // surrounding markdown document. Empty string for null/invalid dates so
  // downstream tooling gets a valid (if terse) markdown document.
  static markdown = class Markdown extends Component<typeof this> {
    get formatted() {
      return formatDateForMarkdown(this.args.model);
    }
    <template>{{this.formatted}}</template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        type='date'
        @value={{this.formatted}}
        @onInput={{fn this.parseInput @set}}
        @max='9999-12-31'
        @disabled={{not @canEdit}}
        data-test-date-field-editor
      />
    </template>

    parseInput(set: Function, date: string) {
      if (!date?.length) {
        return set(null);
      }
      let parsed = parse(date, dateFormat, new Date());
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
      return getSerializer(DateField[fieldSerializer]).serialize(
        this.args.model,
      );
    }
  };
}
