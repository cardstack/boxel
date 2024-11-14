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
    if (!this.range.start && !this.range.end) {
      return '[Select a date range]';
    }
    let start = this.range.start
      ? Format.format(this.range.start)
      : '[Select start date]';
    let end = this.range.end
      ? Format.format(this.range.end)
      : '[Select end date]';
    return `${start} - ${end}`;
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
  @field start = contains(DateField);
  @field end = contains(DateField);
  @field title = contains(StringField, {
    computeVia: function (this: DateRangeField) {
      return 'Date Range';
    },
  });

  static edit = Edit;
}
