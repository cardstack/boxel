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
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';

import DatetimeField from '../fields/date-time';
import RelativeTimeField from '../fields/time/relative-time';

export class DatetimeFieldsPreview extends CardDef {
  @field datetimeField = contains(DatetimeField, {
    configuration: {
      presentation: 'expirationWarning',
      expirationOptions: {
        itemName: 'API Token',
      },
    },
  });
  @field relativeTimeField = contains(RelativeTimeField);

  static displayName = 'DateTime Fields Preview';
  static icon = CalendarClockIcon;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='DatetimeField'
          @icon={{this.getFieldIcon 'datetimeField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.datetimeField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.datetimeField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.datetimeField @format='atom' />
          </FieldContainer>
        </FieldContainer>

        <FieldContainer
          @label='RelativeTimeField'
          @icon={{this.getFieldIcon 'relativeTimeField'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.relativeTimeField @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.relativeTimeField @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.relativeTimeField @format='atom' />
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
