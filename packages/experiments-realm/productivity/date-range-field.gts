import DateField from 'https://cardstack.com/base/date';
import {
  FieldDef,
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import {
  DateRangePicker,
  BoxelDropdown,
  Pill,
  BoxelButton,
} from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

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
  @tracked closeWithoutSaving: boolean = false;

  get formatted() {
    return getFormattedDate(this.range);
  }

  @action onSelect(selected: any) {
    this.range = selected.date;
  }

  isSameAsModel(range: DateRange) {
    if (
      !this.args.model.start &&
      !this.args.model.end &&
      !this.range.start &&
      !this.range.end
    ) {
      return true;
    }

    if (
      this.args.model.start &&
      this.args.model.end &&
      range.start &&
      range.end
    ) {
      return (
        this.args.model.start.getTime() === range.start.getTime() &&
        this.args.model.end.getTime() === range.end.getTime()
      );
    } else {
      return false;
    }
  }

  save() {
    if (this.range.start) {
      this.args.model.start = this.range.start;
    }
    if (this.range.end) {
      this.args.model.end = this.range.end;
    }
  }

  @action onClose() {
    if (this.closeWithoutSaving) {
      this.closeWithoutSaving = false;
      return;
    }
    if (this.isSameAsModel(this.range)) {
      return;
    }
    this.save();
  }

  @action cancel(close: () => void) {
    this.closeWithoutSaving = true;
    close();
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
              @kind='primary'
              {{on 'click' (fn this.cancel dd.close)}}
            >Cancel</BoxelButton>
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
      }
    </style>
  </template>
}

export default class DateRangeField extends FieldDef {
  static displayName = 'Date Range';
  static icon = CalendarIcon;
  @field start = contains(DateField);
  @field end = contains(DateField);
  @field title = contains(StringField, {
    computeVia: function (this: DateRangeField) {
      return 'Date Range';
    },
  });

  static edit = Edit;
  static atom = class Atom extends Component<typeof this> {
    // Note: The designs are slightly inconsistent with the data structure of the card
    // this function is used to determine if the end date is missing, so we can display (although there is more data behind the scenes)
    get hasNoDueDateInfo() {
      return !this.args.model.end;
    }

    get formatted() {
      return getFormattedDate(this.args.model as DateRange, {
        dueDateOnly: true,
        noDateMsg: '[No date assigned]',
      });
    }

    get dateIcon() {
      return this.args.model.constructor?.icon;
    }

    <template>
      <time class='date-info'>
        {{#if this.dateIcon}}
          <this.dateIcon class='icon' />
        {{/if}}
        <div class={{cn 'text' no-date-info=this.hasNoDueDateInfo}}>
          {{this.formatted}}
        </div>
      </time>
      <style scoped>
        .date-info {
          --date-icon-size: 14px;
          display: inline-flex;
          align-items: center;
          font-size: calc(var(--date-icon-size) * 0.9);
          gap: var(--boxel-sp-xxs);
          white-space: nowrap;
          -webkit-line-clamp: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
        }
        .icon {
          width: var(--date-icon-size);
          height: var(--date-icon-size);
        }
        .text {
          color: var(--boxel-600);
        }
        .text.no-date-info {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };
}

interface DateRangeConfig {
  dueDateOnly: boolean;
  noDateMsg: string;
}

function getFormattedDate(
  range: DateRange,
  config: Partial<DateRangeConfig> = {},
): string {
  const defaults = {
    dueDateOnly: false,
    noDateMsg: '[Select a date]',
  };
  const finalConfig = { ...defaults, ...config };

  if (!range.start && !range.end) {
    return finalConfig.noDateMsg;
  }
  let start = range.start ? Format.format(range.start) : '[Select start date]';
  let end = range.end ? Format.format(range.end) : '[Select end date]';
  if (finalConfig.dueDateOnly === true) {
    return end;
  }
  return `${start} - ${end}`;
}
