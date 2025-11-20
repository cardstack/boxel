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
   * Example 1: Basic Upload (No Features)
   * - Click-only upload
   * - No drag-and-drop
   * - Simple file picker
   */
  @field basicUpload = contains(SingleUploadField, {
    configuration: {
      presentation: {
        type: 'single',
        features: [], // No features enabled
        placeholder: 'Click to upload an image',
        validation: {
          maxFileSize: 10 * 1024 * 1024, // 10MB
          allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
        },
      },
    },
  });

  /**
   * Example 2: Drag-Drop Upload
   * - Drag-and-drop enabled
   * - Visual drop zone feedback
   * - Custom drop zone label
   */
  @field dragDropUpload = contains(SingleUploadField, {
    configuration: {
      presentation: {
        type: 'single',
        features: ['drag-drop'], // Enable drag-and-drop
        placeholder: 'Click to upload or drag & drop',
        validation: {
          maxFileSize: 10 * 1024 * 1024, // 10MB
          allowedFormats: ['image/jpeg', 'image/png'],
        },
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Drop your image here or click to upload',
          },
        },
      },
    },
  });

  /**
   * Example 3: Full-Featured Upload
   * - All features enabled
   * - Drag-and-drop
   * - Image validation (dimensions, aspect ratio)
   * - Upload progress indicators
   */
  @field fullFeaturedUpload = contains(SingleUploadField, {
    configuration: {
      presentation: {
        type: 'single',
        features: ['drag-drop', 'validated', 'progress'], // All features
        placeholder: 'Upload your profile photo',
        validation: {
          maxFileSize: 5 * 1024 * 1024, // 5MB
          allowedFormats: ['image/jpeg', 'image/png'],
          minWidth: 400,
          minHeight: 400,
          maxWidth: 2000,
          maxHeight: 2000,
          aspectRatio: '1/1', // Square images only
        },
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Drop photo here or click to upload',
          },
        },
      },
    },
  });

  static displayName = 'Single Upload Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <h2 class='section-title'>Single Upload Field - Three Configurations</h2>

        <!-- Example 1: Basic Upload -->
        <FieldContainer
          @label='1. Basic Upload (No Features)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Click-only upload with no drag-and-drop</p>
          <@fields.basicUpload @format='edit' />
        </FieldContainer>

        <!-- Example 2: Drag-Drop Upload -->
        <FieldContainer
          @label='2. Drag-Drop Upload'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Drag-and-drop enabled with visual feedback</p>
          <@fields.dragDropUpload @format='edit' />
        </FieldContainer>

        <!-- Example 3: Full-Featured Upload -->
        <FieldContainer
          @label='3. Full-Featured Upload'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>All features: drag-drop, validation, progress</p>
          <@fields.fullFeaturedUpload @format='edit' />
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 8);
          padding: calc(var(--spacing, 0.25rem) * 8);
          max-width: 800px;
          margin: 0 auto;
        }

        .section-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground, #111827);
          margin: 0 0 calc(var(--spacing, 0.25rem) * 6) 0;
          padding-bottom: calc(var(--spacing, 0.25rem) * 4);
          border-bottom: 2px solid var(--border, #e5e7eb);
        }

        .description {
          margin: 0 0 calc(var(--spacing, 0.25rem) * 4) 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
          font-style: italic;
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
