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
import ClockIcon from '@cardstack/boxel-icons/clock';

import TimeField from '../fields/time';
import TimeRangeField from '../fields/time/time-range';
import DurationField from '../fields/time/duration';

export class TimeFieldsPreview extends CardDef {
  @field timeField = contains(TimeField, {
    configuration: {
        timeStyle: 'long',
    },
  });
  @field timeRangeField = contains(TimeRangeField);
  @field durationField = contains(DurationField);

  static displayName = 'Time Fields Preview';
  static icon = ClockIcon;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='TimeField'
          @icon={{this.getFieldIcon 'timeField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.timeField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.timeField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.timeField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='TimeRangeField'
          @icon={{this.getFieldIcon 'timeRangeField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.timeRangeField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.timeRangeField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.timeRangeField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='DurationField'
          @icon={{this.getFieldIcon 'durationField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.durationField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.durationField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.durationField @format='atom' />
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
