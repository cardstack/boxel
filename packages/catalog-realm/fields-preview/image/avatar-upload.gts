import AvatarField from '../../fields/image/avatar';

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

export class AvatarUploadPreview extends CardDef {
  /**
   * Example 1: Circular Avatar (Default)
   * - Circular avatar display
   * - Drag-and-drop upload
   * - Progress indicators
   */
  @field circularAvatar = contains(AvatarField, {
    configuration: {
      presentation: {
        type: 'avatar',
        circular: true,
        features: ['drag-drop', 'progress'],
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Drop your profile photo here',
          },
        },
      },
    },
  });

  /**
   * Example 2: Square Avatar
   * - Square avatar display
   * - Custom size
   * - Validation enabled
   */
  @field squareAvatar = contains(AvatarField, {
    configuration: {
      presentation: {
        type: 'avatar',
        circular: false,
        features: ['drag-drop', 'validated', 'progress'],
        validation: {
          maxFileSize: 3 * 1024 * 1024, // 3MB
          allowedFormats: ['image/jpeg', 'image/png'],
          minWidth: 200,
          minHeight: 200,
          maxWidth: 1000,
          maxHeight: 1000,
          aspectRatio: '1/1',
        },
        uploadOptions: {
          dragDrop: {
            dropzoneLabel: 'Upload square avatar',
          },
        },
      },
    },
  });

  /**
   * Example 3: Basic Avatar (No Features)
   * - Simple click-to-upload
   * - No drag-and-drop
   * - No progress indicators
   */
  @field basicAvatar = contains(AvatarField, {
    configuration: {
      presentation: {
        type: 'avatar',
        circular: true,
        features: [], // No features
        validation: {
          maxFileSize: 2 * 1024 * 1024, // 2MB
          allowedFormats: ['image/jpeg', 'image/png'],
          aspectRatio: '1/1',
        },
      },
    },
  });

  static displayName = 'Avatar Upload Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <h2 class='section-title'>Avatar Upload Field - Three Configurations</h2>

        <!-- Example 1: Circular Avatar -->
        <FieldContainer
          @label='1. Circular Avatar (Full Featured)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Circular avatar with drag-drop and progress</p>
          <@fields.circularAvatar @format='edit' />
        </FieldContainer>

        <!-- Example 2: Square Avatar -->
        <FieldContainer
          @label='2. Square Avatar (With Validation)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Square avatar with dimension validation</p>
          <@fields.squareAvatar @format='edit' />
        </FieldContainer>

        <!-- Example 3: Basic Avatar -->
        <FieldContainer
          @label='3. Basic Avatar (Click Upload Only)'
          @tag='section'
          @vertical={{true}}
          @displayBoundaries={{true}}
        >
          <p class='description'>Simple click-to-upload avatar</p>
          <@fields.basicAvatar @format='edit' />
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
