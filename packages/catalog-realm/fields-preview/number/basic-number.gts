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

export class BasicNumberPreview extends CardDef {
  /**
   * Basic Number Field (no type specified - uses default rendering)
   *
   * This is the simplest form of NumberField with no configuration.
   * It displays a plain number without any special formatting or styling.
   *
   * To use advanced features like prefix/suffix, min/max, labels, or special rendering,
   * specify a type and use one of the specialized number field configurations:
   * - type: 'slider' - See SliderNumberPreview
   * - type: 'rating' - See RatingNumberPreview
   * - type: 'percentage' - See PercentageNumberPreview
   * - type: 'stat' - See StatNumberPreview
   * - type: 'gauge' - See GaugeNumberPreview
   * - type: 'badge-notification' - See BadgeNotificationNumberPreview
   * - type: 'badge-metric' - See BadgeMetricNumberPreview
   * - type: 'badge-counter' - See BadgeCounterNumberPreview
   * - type: 'score' - See ScoreNumberPreview
   * - type: 'progress-bar' - See ProgressBarNumberPreview
   * - type: 'progress-circle' - See ProgressCircleNumberPreview
   * - type: 'quantity' - See QuantityNumberPreview
   */
  @field basicNumber = contains(NumberField);

  static displayName = 'Basic Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Basic Number Field'
          @icon={{this.getFieldIcon 'basicNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.basicNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.basicNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.basicNumber @format='embedded' />
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
