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

export class SliderNumberPreview extends CardDef {
  /**
   * Slider Field - Visual slider representation with percentage fill
   * 
   * Accepted configuration options:
   * - type: 'slider' - REQUIRED to use slider rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - showValue?: boolean - Show the numeric value alongside slider
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   */
  @field sliderNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'slider',
        min: 0,
        max: 100,
        suffix: '',
        showValue: true,
      },
    },
  });

  static displayName = 'Slider Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Slider Number Field'
          @icon={{this.getFieldIcon 'sliderNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.sliderNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.sliderNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.sliderNumber @format='embedded' />
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
