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

export class RatingNumberPreview extends CardDef {
  /**
   * Rating Field - Star-based rating system
   * 
   * Accepted configuration options:
   * - type: 'rating' - REQUIRED to use rating rendering
   * - maxStars: number - REQUIRED maximum number of stars
   */
  @field ratingNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'rating',
        maxStars: 5,
      },
    },
  });

  static displayName = 'Rating Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Rating Number Field'
          @icon={{this.getFieldIcon 'ratingNumber'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.ratingNumber @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.ratingNumber @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.ratingNumber @format='embedded' />
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
