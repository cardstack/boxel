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

export class GaugeNumberPreview extends CardDef {
  /**
   * Gauge Field - Gauge display with thresholds for visual warnings
   *
   * Accepted configuration options:
   * - type: 'gauge' - REQUIRED to use gauge rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   * - label?: string - Label text for the gauge
   * - showValue?: boolean - Show the numeric value
   * - warningThreshold?: number - Value above which gauge shows warning color
   * - dangerThreshold?: number - Value above which gauge shows danger color
   */
  @field gaugeNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'gauge',
        min: 0,
        max: 300,
        suffix: '',
        label: 'CPU Usage',
        warningThreshold: 70,
        dangerThreshold: 90,
      },
    },
  });

  static displayName = 'Gauge Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Gauge Number Field'
          @icon={{this.getFieldIcon 'gaugeNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.gaugeNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.gaugeNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.gaugeNumber @format='embedded' />
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
