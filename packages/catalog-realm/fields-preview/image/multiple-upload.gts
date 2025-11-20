import MultipleUploadField from '../../fields/image/multiple';

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

export class MultipleUploadPreview extends CardDef {
  /**
   * Multiple Upload Image Field
   *
   * An image upload field that supports multiple file selection with drag-and-drop.
   * Displays images in a list layout with individual remove buttons for each image.
   * Perfect for galleries, product photos, and multi-image uploads.
   *
   * Supported features: ['drag-drop', 'validated', 'progress']
   * - 'drag-drop': File upload via drag & drop + drag to reorder list items
   * - 'validated': Dimension/aspect ratio validation before upload
   * - 'progress': Real-time upload progress indicators
   */
  @field multipleUpload = contains(MultipleUploadField, {
    configuration: {
      presentation: {
        type: 'multiple',
      },
    },
  });

  static displayName = 'Multiple Upload Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Multiple Upload Image Field'
          @icon={{this.getFieldIcon 'multipleUpload'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.multipleUpload @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.multipleUpload @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.multipleUpload @format='embedded' />
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
