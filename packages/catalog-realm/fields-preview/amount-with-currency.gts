import { AmountWithCurrency as AmountWithCurrencyField } from '../fields/amount-with-currency';

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

export class AmountWithCurrencyPreview extends CardDef {
  @field amountWithCurrency = contains(AmountWithCurrencyField);

  static displayName = 'Amount With Currency Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Amount With Currency'
          @icon={{this.getFieldIcon 'amountWithCurrency'}}
        >
          <FieldContainer @vertical={{true}} @label='Edit'>
            <@fields.amountWithCurrency @format='edit' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.amountWithCurrency @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.amountWithCurrency @format='embedded' />
          </FieldContainer>
        </FieldContainer>

        {{! no list preview needed }}
      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
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
