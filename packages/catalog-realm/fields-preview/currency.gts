import { CurrencyField } from '../fields/currency';

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

export class CurrencyPreview extends CardDef {
  @field currency = contains(CurrencyField);

  static displayName = 'Currency Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Currency'
          @icon={{this.getFieldIcon 'currency'}}
        >
          <FieldContainer @vertical={{true}} @label='Edit'>
            <@fields.currency @format='edit' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.currency @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.currency @format='embedded' />
          </FieldContainer>
        </FieldContainer>
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

