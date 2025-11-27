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
import RepeatIcon from '@cardstack/boxel-icons/repeat';

import RecurringPatternField from '../fields/recurring-pattern';

export class RecurringPatternPreview extends CardDef {
  @field recurringPattern = contains(RecurringPatternField);

  static displayName = 'Recurring Pattern Preview';
  static icon = RepeatIcon;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='RecurringPatternField'
          @icon={{this.getFieldIcon 'recurringPattern'}}
          @vertical={{true}}
        >
          <FieldContainer @label='Edit'>
            <@fields.recurringPattern @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Embedded'>
            <@fields.recurringPattern @format='embedded' />
          </FieldContainer>
          <FieldContainer @label='Atom'>
            <@fields.recurringPattern @format='atom' />
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
