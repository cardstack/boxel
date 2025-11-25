import ImageIcon from '@cardstack/boxel-icons/image';
import { ImageField } from '../fields/image-field';
import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { getField } from '@cardstack/runtime-common';

export class ImageFieldsPreview extends CardDef {
  static displayName = 'Image Fields Preview';
  static icon = ImageIcon;

  // Basic image field (default - no type specified)
  @field basicImage = contains(ImageField);

  // Avatar variant with tile presentation
  @field avatarImage = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'tile',
    },
  });

  // Dropzone variant with compact presentation
  @field dropzoneImage = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'compact',
      options: {
        showImageModal: true,
        showProgress: true,
      },
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };

    <template>
      <div class='image-fields-preview'>
        <header class='header'>
          <h1 class='title'>Image Fields Showcase</h1>
          <p class='subtitle'>Comprehensive preview of all image field types
            with configurations</p>
        </header>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>1. Browse Image</h2>
            <p class='section-description'>Standard file browser for image
              uploads</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Upload or select an image</p>
              <@fields.basicImage @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.basicImage @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.basicImage @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>2. Avatar Image</h2>
            <p class='section-description'>Optimized for profile pictures and
              avatars</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Upload or select a profile picture</p>
              <@fields.avatarImage @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.avatarImage @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.avatarImage @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>3. Dropzone Image</h2>
            <p class='section-description'>Drag and drop interface for image
              uploads</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Drag and drop an image here</p>
              <@fields.dropzoneImage @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.dropzoneImage @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.dropzoneImage @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <style scoped>
        .image-fields-preview {
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
          margin: 0 0 var(--boxel-sp-xxxs);
          font-family: var(--boxel-font-family);
        }

        .section-description {
          font-size: 1rem;
          color: var(--boxel-500);
          margin: 0;
          font-family: var(--boxel-font-family);
        }

        .field-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-xxl);
          margin-top: var(--boxel-sp-lg);
        }

        .edit-column,
        .display-column {
          flex: 1;
          min-width: 0;
        }

        .column-header {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--boxel-700);
          margin: 0 0 var(--boxel-sp-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .column-subtitle {
          font-size: 0.875rem;
          color: var(--boxel-500);
          margin: 0 0 var(--boxel-sp);
          font-family: var(--boxel-font-family);
        }

        .display-group {
          margin-bottom: var(--boxel-sp-xl);
        }

        .display-group:last-child {
          margin-bottom: 0;
        }

        .display-item {
          margin-bottom: var(--boxel-sp);
        }

        .display-item p {
          font-size: 0.875rem;
          color: var(--boxel-600);
          margin: 0 0 var(--boxel-sp-xxs);
          font-family: var(--boxel-font-family);
        }

        .field-box {
          padding: var(--boxel-sp);
          background: var(--boxel-50);
          border: 1px solid var(--boxel-100);
          border-radius: var(--boxel-border-radius-sm);
        }

        pre {
          margin: 0;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      </style>
    </template>
  };
}
