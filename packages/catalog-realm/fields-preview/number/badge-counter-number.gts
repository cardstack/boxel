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

export class BadgeCounterNumberPreview extends CardDef {
  /**
   * Badge Counter Field - Counter-style badge display
   *
   * Accepted configuration options:
   * - type: 'badge-counter' - REQUIRED to use badge counter rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places (typically 0 for counters)
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   * - label?: string - Label text for the badge
   */
  @field badgeCounterNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-counter',
        decimals: 0,
        min: 0,
        max: 100,
        label: 'Stocks',
      },
    },
  });

  static displayName = 'Badge Counter Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Badge Counter Number Field'
          @icon={{this.getFieldIcon 'badgeCounterNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.badgeCounterNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.badgeCounterNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.badgeCounterNumber @format='embedded' />
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
