import DateField from './date';
import { FieldDef, contains, field, Component } from './card-api';
import {
  DateRangePicker,
  BoxelDropdown,
  Pill,
  BoxelButton,
} from '@cardstack/boxel-ui/components';
import StringField from './string';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import CalendarStatsIcon from '@cardstack/boxel-icons/calendar-stats';
import { eq, formatDateTime } from '@cardstack/boxel-ui/helpers';
import { formatDateRangeForMarkdown } from './markdown-helpers';
import { BusinessDays } from './components/business-days';

interface DateRangeFieldConfiguration {
  presentation?: 'standard' | 'businessDays';
}

const Format = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

interface DateRange {
  start: Date | null | undefined;
  end: Date | null | undefined;
}

class Edit extends Component<typeof DateRangeField> {
  @tracked range: DateRange = {
    start: this.args.model.start,
    end: this.args.model.end,
  };

  get formatted() {
    return getFormattedDate(this.range);
  }

  @action onSelect(selected: any) {
    this.range = selected.date;
  }

  write() {
    if (this.range.start) {
      this.args.model.start = this.range.start;
    }
    if (this.range.end) {
      this.args.model.end = this.range.end;
    }
  }

  @action save(close: () => void) {
    this.write();
    close();
  }

  @action onClose() {
    this.range = {
      start: this.args.model.start,
      end: this.args.model.end,
    };
  }
  // reset allows the user to
  //1. decide if he even wants a field to be present (ie he might want an empty date range)
  //2. allows the user to also go back to the original state of TODAY while editing
  @action reset() {
    this.range = {
      start: null,
      end: null,
    };
    this.args.model.start = undefined;
    this.args.model.end = undefined;
  }

  <template>
    <BoxelDropdown @onClose={{this.onClose}}>
      <:trigger as |bindings|>
        <Pill {{bindings}} @kind='button'>
          {{this.formatted}}
        </Pill>
      </:trigger>
      <:content as |dd|>
        <div class='dropdown-content'>
          <div>
            <DateRangePicker
              @start={{this.range.start}}
              @end={{this.range.end}}
              @onSelect={{this.onSelect}}
              @selected={{this.range}}
            />
          </div>
          <div class='dropdown-actions'>
            <BoxelButton
              @kind='secondary'
              {{on 'click' this.reset}}
            >Reset</BoxelButton>
            <BoxelButton
              @kind='primary'
              {{on 'click' (fn this.save dd.close)}}
            >Save</BoxelButton>
          </div>
        </div>
      </:content>
    </BoxelDropdown>
    <style scoped>
      .dropdown-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
      }
      .dropdown-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>
}

export default class DateRangeField extends FieldDef {
  static displayName = 'Date Range';
  static icon = CalendarIcon;
  @field start = contains(DateField);
  @field end = contains(DateField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: DateRangeField) {
      return 'Date Range';
    },
  });

  static edit = Edit;
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const start = this.args.model?.start;
      const end = this.args.model?.end;

      if (!start && !end) return 'No date range set';

      try {
        const formatDate = (dateValue: string | Date) => {
          const date =
            typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
          return formatDateTime(date, {
            preset: 'short',
            fallback: String(dateValue),
          });
        };

        if (!start) return `Until ${formatDate(end!)}`;
        if (!end) return `From ${formatDate(start)}`;

        return `${formatDate(start)} - ${formatDate(end)}`;
      } catch {
        return `${start} - ${end}`;
      }
    }

    <template>
      <span class='date-range-atom' data-test-date-range-atom>
        <CalendarStatsIcon class='range-icon' />
        <span class='range-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .date-range-atom {
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

  static embedded = class Embedded extends Component<typeof this> {
    get config(): DateRangeFieldConfiguration | undefined {
      return this.args.configuration as DateRangeFieldConfiguration | undefined;
    }

    get presentationMode() {
      return this.config?.presentation ?? 'standard';
    }

    get displayValue() {
      const start = this.args.model?.start;
      const end = this.args.model?.end;

      if (!start && !end) return 'No date range set';

      try {
        const format = (value: Date) =>
          formatDateTime(value, {
            preset: 'long',
            fallback: 'Invalid date',
          });

        if (!start) return `Until ${format(end!)}`;
        if (!end) return `From ${format(start)}`;

        return `${format(start)} → ${format(end)}`;
      } catch {
        return 'Invalid date range';
      }
    }

    <template>
      {{#if (eq this.presentationMode 'businessDays')}}
        <BusinessDays @model={{@model}} @config={{this.config}} />
      {{else}}
        <div class='date-range-embedded' data-test-date-range-embedded>
          <span class='range-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .date-range-embedded {
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

  // CS-10786: consistent markdown-escaped range output. Uses the shared
  // helper so formatting matches DateField/DateTimeField.
  static markdown = class Markdown extends Component<typeof this> {
    get formatted() {
      return formatDateRangeForMarkdown(
        this.args.model.start,
        this.args.model.end,
      );
    }
    <template>{{this.formatted}}</template>
  };
}

interface DateRangeConfig {
  noDateMsg: string;
}

function getFormattedDate(
  range: DateRange,
  config: Partial<DateRangeConfig> = {},
): string {
  const defaults = {
    noDateMsg: '[Select a date]',
  };
  const finalConfig = { ...defaults, ...config };

  if (!range.start && !range.end) {
    return finalConfig.noDateMsg;
  }
  let start = range.start ? Format.format(range.start) : '[Select start date]';
  let end = range.end ? Format.format(range.end) : '[Select end date]';
  return `${start} - ${end}`;
}
