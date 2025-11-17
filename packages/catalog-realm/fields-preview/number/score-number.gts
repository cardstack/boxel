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

export class ScoreNumberPreview extends CardDef {
  /**
   * Score Field - Score display with customizable range and formatting
   * 
   * Accepted configuration options:
   * - type: 'score' - REQUIRED to use score rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   */
  @field scoreNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'score',
        decimals: 0,
        min: 0,
        max: 1000,
      },
    },
  });

  static displayName = 'Score Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Score Number Field'
          @icon={{this.getFieldIcon 'scoreNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.scoreNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.scoreNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.scoreNumber @format='embedded' />
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
