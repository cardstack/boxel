import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';
import CalendarIcon from '@cardstack/boxel-icons/calendar';

import DateField from '../fields/date';
import DateRangeField from '../fields/date/date-range';
import MonthDayField from '../fields/date/month-day';
import YearField from '../fields/date/year';
import MonthField from '../fields/date/month';
import MonthYearField from '../fields/date/month-year';
import WeekField from '../fields/date/week';
import QuarterField from '../fields/date/quarter';

export class DateFieldsPreview extends CardDef {
  @field dateField = contains(DateField);
  @field dateRangeField = contains(DateRangeField, {
    configuration: {
      presentation: 'businessDays',
    },
  });
  @field monthDayField = contains(MonthDayField);
  @field yearField = contains(YearField);
  @field monthField = contains(MonthField);
  @field monthYearField = contains(MonthYearField);
  @field weekField = contains(WeekField);
  @field quarterField = contains(QuarterField);

  static displayName = 'Date Fields Preview';
  static icon = CalendarIcon;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='DateField'
          @icon={{this.getFieldIcon 'dateField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.dateField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.dateField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.dateField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='DateRangeField'
          @icon={{this.getFieldIcon 'dateRangeField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.dateRangeField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.dateRangeField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.dateRangeField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='MonthDayField'
          @icon={{this.getFieldIcon 'monthDayField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.monthDayField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.monthDayField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.monthDayField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='YearField'
          @icon={{this.getFieldIcon 'yearField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.yearField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.yearField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.yearField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='MonthField'
          @icon={{this.getFieldIcon 'monthField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.monthField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.monthField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.monthField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='MonthYearField'
          @icon={{this.getFieldIcon 'monthYearField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.monthYearField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.monthYearField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.monthYearField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='WeekField'
          @icon={{this.getFieldIcon 'weekField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.weekField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.weekField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.weekField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='QuarterField'
          @icon={{this.getFieldIcon 'quarterField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.quarterField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.quarterField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.quarterField @format='atom' />
          </FieldContainer>
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-xxl);
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };
  };
}
