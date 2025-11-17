import NumberField from '../../fields/number';

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

export class PercentageNumberPreview extends CardDef {
  /**
   * Percentage Field - Percentage with visual bar representation
   *
   * Accepted configuration options:
   * - type: 'percentage' - REQUIRED to use percentage rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   */
  @field percentageNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 200,
        decimals: 2,
      },
    },
  });

  static displayName = 'Percentage Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Percentage Number Field'
          @icon={{this.getFieldIcon 'percentageNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.percentageNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.percentageNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.percentageNumber @format='embedded' />
            </FieldContainer>
          </div>
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
        }
        .field-formats {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
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
