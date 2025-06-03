import { FeaturedImageField } from '../fields/featured-image';

import {
  CardDef,
  field,
  contains,
  containsMany,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class FeaturedImagePreview extends CardDef {
  @field featuredImage = contains(FeaturedImageField);
  @field images = containsMany(FeaturedImageField);

  static displayName = 'Featured Image Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Featured Image'
          @icon={{this.getFieldIcon 'featuredImage'}}
        >
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.featuredImage @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.featuredImage @format='embedded' />
          </FieldContainer>
        </FieldContainer>
        <FieldContainer @label='Images' @icon={{this.getFieldIcon 'images'}}>
          <FieldContainer @vertical={{true}} @label='Atom'>
            <@fields.images @format='atom' />
          </FieldContainer>
          <FieldContainer @vertical={{true}} @label='Embedded'>
            <@fields.images @format='embedded' />
          </FieldContainer>
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
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
