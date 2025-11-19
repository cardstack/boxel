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
   * Displays images in a grid layout with individual remove buttons for each image.
   * Perfect for galleries, product photos, and multi-image uploads.
   *
   * Accepted configuration options:
   * - type: 'multiple' - REQUIRED to use multiple upload rendering
   * - maxSize?: number - Maximum file size in bytes per file (default: 10MB)
   * - maxFiles?: number - Maximum number of files allowed (default: 10)
   * - allowedFormats?: string[] - Allowed file formats (default: ['jpeg', 'jpg', 'png', 'gif'])
   * - scrollable?: boolean - Whether grid should scroll horizontally (true) or stack vertically (false, default: true)
   * - showPreview?: boolean - Show image previews (default: true)
   * - showFileName?: boolean - Show uploaded file names (default: true)
   * - showFileSize?: boolean - Show uploaded file sizes (default: true)
   */
  @field multipleUpload = contains(MultipleUploadField, {
    configuration: {
      presentation: {
        type: 'multiple',
        maxSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 10,
        allowedFormats: ['jpeg', 'jpg', 'png'],
        scrollable: true,
        showPreview: true,
        showFileName: true,
        showFileSize: true,
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
