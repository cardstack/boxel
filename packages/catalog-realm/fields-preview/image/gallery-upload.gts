import GalleryField from '../../fields/image/gallery';

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

export class GalleryUploadPreview extends CardDef {
  /**
   * Example 1: Portfolio Gallery (Standard)
   * - Auto-responsive grid (200px items)
   * - Drag-and-drop upload
   * - Batch selection and deletion
   * - Reordering enabled
   */
  @field portfolioGallery = contains(GalleryField, {
    configuration: {
      presentation: {
        type: 'gallery',
        itemSize: '200px',
        gap: '1rem',
        allowBatchSelect: true,
        features: ['drag-drop', 'reorder', 'progress', 'batch-select'],
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Drop photos here to add to gallery',
          },
        },
        reorderOptions: {
          enabled: true,
          handleClass: 'drag-handle',
          animation: 150,
        },
      },
    },
  });

  /**
   * Example 2: Compact Gallery (Small Items)
   * - Auto-responsive grid (150px items)
   * - Smaller gap
   * - No batch selection
   * - Maximum 30 files
   */
  @field compactGallery = contains(GalleryField, {
    configuration: {
      presentation: {
        type: 'gallery',
        itemSize: '150px',
        gap: '0.5rem',
        allowBatchSelect: false,
        features: ['drag-drop', 'validated', 'progress'],
        validation: {
          maxFileSize: 5 * 1024 * 1024, // 5MB
          maxFiles: 30,
          allowedFormats: ['image/jpeg', 'image/png'],
          minWidth: 200,
          minHeight: 200,
        },
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Add images to compact gallery',
          },
        },
        reorderOptions: {
          enabled: false,
        },
      },
    },
  });

  /**
   * Example 3: Large Preview Gallery (Big Items)
   * - Auto-responsive grid (300px items)
   * - Larger gap between items
   * - Batch operations enabled
   * - Strict validation
   */
  @field largePreviewGallery = contains(GalleryField, {
    configuration: {
      presentation: {
        type: 'gallery',
        itemSize: '300px',
        gap: '1.5rem',
        allowBatchSelect: true,
        features: [
          'drag-drop',
          'reorder',
          'validated',
          'progress',
          'batch-select',
        ],
        validation: {
          maxFileSize: 15 * 1024 * 1024, // 15MB
          maxFiles: 20,
          allowedFormats: ['image/jpeg', 'image/png'],
          minWidth: 800,
          minHeight: 600,
          aspectRatio: '4/3',
        },
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Upload high-quality photos (4:3 ratio)',
          },
        },
        reorderOptions: {
          enabled: true,
          handleClass: 'drag-handle',
          animation: 150,
        },
      },
    },
  });

  static displayName = 'Gallery Upload Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <h2 class='section-title'>Gallery Upload Field - Three Configurations</h2>

        <!-- Example 1: Portfolio Gallery -->
        <FieldContainer
          @label='1. Portfolio Gallery (Standard 200px)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Auto-responsive gallery with batch selection</p>
          <@fields.portfolioGallery @format='edit' />
        </FieldContainer>

        <!-- Example 2: Compact Gallery -->
        <FieldContainer
          @label='2. Compact Gallery (Small 150px)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Dense layout with smaller items</p>
          <@fields.compactGallery @format='edit' />
        </FieldContainer>

        <!-- Example 3: Large Preview Gallery -->
        <FieldContainer
          @label='3. Large Preview Gallery (Big 300px)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Large items with strict aspect ratio</p>
          <@fields.largePreviewGallery @format='edit' />
        </FieldContainer>
      </section>
      <style scoped>
        .fields {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 8);
          padding: calc(var(--spacing, 0.25rem) * 8);
          max-width: 1200px;
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
