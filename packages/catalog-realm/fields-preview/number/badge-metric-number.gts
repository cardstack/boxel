import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
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

export class BadgeMetricNumberPreview extends CardDef {
  /**
   * Badge Metric Field - Metric-style badge display
   *
   * Accepted configuration options:
   * - type: 'badge-metric' - REQUIRED to use badge metric rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   * - label?: string - Label text for the badge
   * - icon?: IconComponent - Icon to display with the badge
   */
  @field badgeMetricNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-metric',
        decimals: 0,
        min: 0,
        max: 1000,
        label: 'Items',
        icon: TrendingUpIcon,
      },
    },
  });

  static displayName = 'Badge Metric Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Badge Metric Number Field'
          @icon={{this.getFieldIcon 'badgeMetricNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.badgeMetricNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.badgeMetricNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.badgeMetricNumber @format='embedded' />
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
