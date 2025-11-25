import ImageIcon from '@cardstack/boxel-icons/image';
import { ImageField } from '../fields/image-field';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';

export class ImageFieldsPreview extends CardDef {
  static displayName = 'Image Fields Preview';
  static icon = ImageIcon;

  /**
   * ImageField Configuration Reference:
   * - basicImage: default (browse variant, image presentation, no options)
   * - avatarImage:
   *     variant = 'avatar',
   *     presentation = 'card',
   *     options = {
   *       autoUpload: false,
   *       showProgress: true
   *     }
   *     (Note: showImageModal not available for avatar)
   * - dropzoneImage:
   *     variant = 'dropzone',
   *     presentation = 'inline',
   *     options = {
   *       showImageModal: true,
   *       showProgress: true,
   *       autoUpload: false
   *     }
   *
   * Valid variants: 'browse' | 'dropzone' | 'avatar'
   * Valid presentations: 'image' | 'inline' | 'card'
   * Options: showImageModal (browse/dropzone only), autoUpload, showProgress
   */

  @field basicImage = contains(ImageField);

  @field avatarImage = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'card',
      options: {
        autoUpload: false,
        showProgress: true,
      },
    },
  });

  @field dropzoneImage = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'inline',
      options: {
        showImageModal: true,
        showProgress: true,
        autoUpload: false,
      },
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='image-fields-preview'>
        <header class='header'>
          <h1 class='title'>{{@model.cardInfo.title}}</h1>
          {{#if @model.cardInfo.description}}
            <p class='subtitle'>{{@model.cardInfo.description}}</p>
          {{/if}}
        </header>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>1. Browse Image Field</h2>
            <p class='section-description'>Click to browse and upload a single
              image. Best for general image uploads where users select files
              from their device using a standard file picker.</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Click the upload button to browse and
                select an image file</p>
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
            <h2 class='section-title'>2. Avatar Image Field</h2>
            <p class='section-description'>Circular image upload optimized for
              profile pictures and avatars. Displays as a round image with a
              camera icon overlay for easy replacement.</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Click the circular avatar area to
                upload or replace a profile picture</p>
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
            <h2 class='section-title'>3. Dropzone Image Field</h2>
            <p class='section-description'>Drag and drop interface for image
              uploads. Users can drag images directly onto the upload area or
              click to browse. Includes progress indicators and zoom preview.</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Drag and drop an image file here, or
                click to browse from your device</p>
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
