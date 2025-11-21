import CubeIcon from '@cardstack/boxel-icons/cube';
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

export class BadgeNotificationNumberPreview extends CardDef {
  /**
   * Badge Notification Field - Notification-style badge display
   *
   * Accepted configuration options:
   * - type: 'badge-notification' - REQUIRED to use badge notification rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - decimals?: number - Number of decimal places (typically 0 for notifications)
   * - prefix?: string - Text before the number
   * - suffix?: string - Text after the number
   * - label?: string - Label text for the badge
   * - icon?: IconComponent - Icon to display with the badge
   */
  @field badgeNotificationNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-notification',
        decimals: 0,
        min: 0,
        max: 9,
        suffix: '+',
        label: 'Notifications',
        icon: CubeIcon,
      },
    },
  });

  static displayName = 'Badge Notification Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Badge Notification Number Field'
          @icon={{this.getFieldIcon 'badgeNotificationNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.badgeNotificationNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.badgeNotificationNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.badgeNotificationNumber @format='embedded' />
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
