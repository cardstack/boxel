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

export class ProgressBarNumberPreview extends CardDef {
  /**
   * Progress Bar Field - Horizontal progress bar with percentage
   * 
   * Accepted configuration options:
   * - type: 'progress-bar' - REQUIRED to use progress bar rendering
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - label?: string - Label text for the progress bar
   */
  @field progressBarNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'progress-bar',
        min: 0,
        max: 100,
        label: 'Progress',
      },
    },
  });

  static displayName = 'Progress Bar Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Progress Bar Number Field'
          @icon={{this.getFieldIcon 'progressBarNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.progressBarNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.progressBarNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.progressBarNumber @format='embedded' />
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
