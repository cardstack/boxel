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

export class StatNumberPreview extends CardDef {
  /**
   * Stat Field - Statistic display with label and optional prefix/suffix
   *
   * Accepted configuration options:
   * - type: 'stat' - REQUIRED to use stat rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places
   * - prefix?: string - Text before the number (e.g., '+', '$')
   * - suffix?: string - Text after the number
   * - label?: string - Label text for the stat
   * - subtitle?: string - Additional subtitle text
   * - icon?: IconComponent - Icon to display with the stat
   */
  @field statNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'stat',
        prefix: '',
        suffix: '',
        min: 0,
        max: 100,
        label: 'Total Revenue',
        subtitle: '↑ 12.5% vs last month',
        icon: TrendingUpIcon,
      },
    },
  });

  static displayName = 'Stat Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Stat Number Field'
          @icon={{this.getFieldIcon 'statNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.statNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.statNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.statNumber @format='embedded' />
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
