import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
import { MultipleImageField } from '../fields/image/multiple-image-field';
import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { getField } from '@cardstack/runtime-common';

export class MultipleImageFieldsPreview extends CardDef {
  static displayName = 'Multiple Image Fields Preview';
  static icon = Grid3x3Icon;

  // Basic multiple image field (default - list variant)
  @field basicMultipleImages = contains(MultipleImageField);

  // Gallery variant
  @field galleryImages = contains(MultipleImageField, {
    configuration: {
      variant: 'gallery',
      presentation: 'featured',
      options: {
        showProgress: true,
        allowBatchSelect: true,
        allowReorder: true,
      },
    },
  });

  // Compact list variant
  @field compactListImages = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'compact',
      options: {
        showProgress: false,
        allowBatchSelect: false,
        allowReorder: true,
      },
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='multiple-image-fields-preview'>
        <header class='header'>
          <h1 class='title'>Multiple Image Fields Showcase</h1>
          <p class='subtitle'>Comprehensive preview of multiple image field
            types with configurations</p>
        </header>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>1. Basic Multiple Images</h2>
            <p class='section-description'>Default list view for multiple image
              uploads</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Upload or select multiple images</p>
              <@fields.basicMultipleImages @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.basicMultipleImages @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>2. Gallery View</h2>
            <p class='section-description'>Grid layout for multiple images with
              batch operations</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Try drag-and-drop reordering</p>
              <@fields.galleryImages @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.galleryImages @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>3. Compact List</h2>
            <p class='section-description'>Space-efficient list view for
              multiple images</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Compact view with reordering</p>
              <@fields.compactListImages @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.compactListImages @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <style scoped>
        .multiple-image-fields-preview {
          max-width: 1400px;
          margin: 0 auto;
          padding: var(--boxel-sp-xxl);
          background: var(--boxel-light);
          font-family: var(--boxel-font-family);
          color: var(--boxel-dark);
        }

        .header {
          margin-bottom: var(--boxel-sp-xxxl);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 2px solid var(--boxel-200);
          text-align: center;
        }

        .title {
          font-size: 2.5rem;
          font-weight: 700;
          color: var(--boxel-dark);
          margin: 0 0 var(--boxel-sp-xs);
          font-family: var(--boxel-font-family);
          letter-spacing: -0.02em;
        }

        .subtitle {
          font-size: 1.125rem;
          color: var(--boxel-450);
          margin: 0;
          font-family: var(--boxel-font-family);
        }

        .field-section {
          margin-bottom: var(--boxel-sp-xxl);
          padding: var(--boxel-sp-xxl);
          background: white;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .section-header {
          margin-bottom: var(--boxel-sp-xl);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--boxel-100);
        }

        .section-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--boxel-dark);
          margin: 0 0 var(--boxel-sp-xxs);
        }

        .section-description {
          font-size: 1rem;
          color: var(--boxel-500);
          margin: 0;
        }

        .field-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-xxl);
          width: 100%;
          overflow: hidden;
        }

        .edit-column,
        .display-column {
          display: flex;
          flex-direction: column;
          min-width: 0; /* Allows the column to shrink below its content's minimum width */
          overflow: hidden; /* Prevents content from overflowing */
        }

        .column-header {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--boxel-600);
          margin-bottom: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp-xs);
          border-bottom: 1px solid var(--boxel-100);
        }

        .column-subtitle {
          font-size: 0.875rem;
          color: var(--boxel-500);
          margin: 0 0 var(--boxel-sp);
          font-style: italic;
        }

        .display-group {
          margin-bottom: var(--boxel-sp);
          width: 100%;
          overflow: hidden;
        }

        /* Ensure the multiple image field respects its container */
        .multiple-image-field-edit {
          width: 100%;
          max-width: 100%;
        }

        /* Style the list container */
        .images-container.variant-list {
          width: 100%;
          max-width: 100%;
        }

        /* Style individual image items in list view */
        .images-container.variant-list .image-item {
          max-width: 100%;
          overflow: hidden;
        }

        /* Ensure file names don't overflow */
        .image-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
          display: block;
        }

        .display-group p {
          font-size: 0.875rem;
          color: var(--boxel-600);
          margin: 0 0 var(--boxel-sp-xxs);
        }

        .field-box {
          padding: var(--boxel-sp);
          background: var(--boxel-50);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius-sm);
        }

        @media (max-width: 1200px) {
          .field-layout {
            grid-template-columns: 1fr;
            gap: var(--boxel-sp-xl);
          }

          .edit-column {
            margin-bottom: var(--boxel-sp-xl);
            padding-bottom: var(--boxel-sp-xl);
            border-bottom: 1px solid var(--boxel-100);
          }
        }
      </style>
    </template>

    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      return field?.def?.icon;
    };
  };
}
