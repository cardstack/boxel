import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

class YearFieldEdit extends Component<typeof YearField> {
  get years() {
    return Array.from({ length: 20 }, (_, i) => 2015 + i).reverse();
  }

  @action
  updateValue(year: number | null) {
    this.args.model.value = year ?? undefined;
  }

  <template>
    <BoxelSelect
      @options={{this.years}}
      @selected={{@model.value}}
      @onChange={{this.updateValue}}
      @placeholder='Select year'
      @dropdownClass='year-dropdown'
      data-test-year-select
      as |year|
    >
      {{year}}
    </BoxelSelect>
  </template>
}

export class YearField extends FieldDef {
  static displayName = 'Year';
  static icon = CalendarEventIcon;

  @field value = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      return this.args.model?.value || 'No year set';
    }

    <template>
      <div class='year-embedded' data-test-year-embedded>
        <span class='year-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .year-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .year-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      return this.args.model?.value || 'No year';
    }

    <template>
      <span class='year-atom' data-test-year-atom>
        <CalendarEventIcon class='year-icon' />
        <span class='year-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .year-atom {
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

        .year-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .year-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static edit = YearFieldEdit;
}

export default YearField;
