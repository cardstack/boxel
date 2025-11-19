import SingleUploadField from '../../fields/image/single';

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

export class SingleUploadPreview extends CardDef {
  /**
   * Single Upload Image Field
   *
   * A simple image upload field with drag-and-drop support.
   * Displays an upload area when empty and shows an image preview after upload.
   * Users can remove the uploaded image by clicking the remove button on hover.
   *
   * Accepted configuration options:
   * - type: 'single' - REQUIRED to use single upload rendering
   * - maxSize?: number - Maximum file size in bytes (default: 10MB)
   * - allowedFormats?: string[] - Allowed file formats (default: ['jpeg', 'jpg', 'png', 'gif'])
   * - showPreview?: boolean - Show image preview (default: true)
   * - showFileName?: boolean - Show uploaded file name (default: true)
   * - showFileSize?: boolean - Show file size (default: true)
   * - placeholder?: string - Placeholder text (default: 'Click to upload')
   */
  @field singleUpload = contains(SingleUploadField, {
    configuration: {
      presentation: {
        type: 'single',
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedFormats: ['jpeg', 'jpg', 'png'],
        showPreview: true,
        showFileName: true,
        showFileSize: true,
        placeholder: 'Click to upload',
      },
    },
  });

  static displayName = 'Single Upload Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Single Upload Image Field'
          @icon={{this.getFieldIcon 'singleUpload'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.singleUpload @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.singleUpload @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.singleUpload @format='embedded' />
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
