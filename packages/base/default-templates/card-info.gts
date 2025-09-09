import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import type { CardOrFieldTypeIcon } from '../card-api';

import setBackgroundImage from '../helpers/set-background-image';

import {
  FieldContainer,
  Button,
  IconButton,
} from '@cardstack/boxel-ui/components';

import IconX from '@cardstack/boxel-icons/x';

class CardInfoImageContainer extends GlimmerComponent<{
  Args: {
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
  Element: HTMLElement;
}> {
  <template>
    <div
      class='cardInfo-image-container thumbnail'
      style={{setBackgroundImage @thumbnailURL}}
      role='presentation'
      data-test-field='thumbnailURL'
      ...attributes
    >
      {{#unless @thumbnailURL}}
        <@icon class='icon' width='50' height='40' data-test-thumbnail-icon />
      {{/unless}}
    </div>
    <style scoped>
      @layer baseComponent {
        .cardInfo-image-container {
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          width: var(--thumbnail-container-size);
          height: var(--thumbnail-container-size);
          min-width: var(--thumbnail-container-size);
          min-height: var(--thumbnail-container-size);
          border-radius: var(--radius, var(--boxel-border-radius-xl));
          background-color: var(--background, var(--boxel-light));
        }
        .thumbnail {
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
      }
    </style>
  </template>
}

export default class CardInfo extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
}> {
  <template>
    <CardInfoImageContainer
      class='image-container'
      @thumbnailURL={{@thumbnailURL}}
      @icon={{@icon}}
    />
    <div class='info'>
      <h2 class='card-info-title' data-test-field='title'>{{@title}}</h2>
      <p class='card-info-description' data-test-field='description'>
        {{@description}}
      </p>
    </div>
    <style scoped>
      @layer baseComponent {
        .image-container {
          --thumbnail-container-size: 6.25rem;
        }
        .card-info-title {
          margin-block: 0;
          font-size: var(--boxel-font-size);
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(22 / 16);
        }
        .card-info-description {
          margin-block: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 400;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(18 / 13);
        }
        .info > * + * {
          margin-top: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

export class CardInfoEditor extends GlimmerComponent<{
  Args: {
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
  Blocks: { default: []; thumbnailEditor: [] };
}> {
  <template>
    <FieldContainer class='cardInfo-editor'>
      <:label>
        <div class='cardInfo-thumbnail-container'>
          <CardInfoImageContainer
            class='cardInfo-thumbnail-preview'
            @thumbnailURL={{@thumbnailURL}}
            @icon={{@icon}}
          />
          <Button
            class='cardInfo-thumbnail-popup-toggle'
            @size='extra-small'
            @kind='secondary-light'
            {{on 'click' this.toggleThumbnailEditor}}
          >
            Change URL
          </Button>
          {{#if this.isThumbnailEditorVisible}}
            <div class='cardInfo-thumbnail-popup'>
              <div class='thumbnail-editor'>
                <IconButton
                  class='thumbnail-editor-close-button'
                  {{on 'click' this.closeThumbnailEditor}}
                  @icon={{IconX}}
                  @width='20px'
                  @height='20px'
                  aria-label='Close thumbnail url input'
                />
                {{yield to='thumbnailEditor'}}
              </div>
            </div>
          {{/if}}
        </div>
      </:label>
      <:default>
        {{yield}}
      </:default>
    </FieldContainer>
    <style scoped>
      @layer baseComponent {
        .cardInfo-editor {
          --thumbnail-container-size: 6.25rem;
          --boxel-button-min-height: 1.5rem;
          position: relative;
          width: 100%;
          max-width: 100%;
        }
        .cardInfo-thumbnail-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-right: var(--boxel-sp-xl);
        }
        .cardInfo-thumbnail-preview {
          border: 1px solid
            var(--border, var(--boxel-form-control-border-color));
        }
        .cardInfo-thumbnail-popup-toggle {
          margin-top: var(--boxel-sp-xs);
        }
        .cardInfo-thumbnail-popup {
          position: absolute;
          left: 0;
          top: calc(
            var(--thumbnail-container-size) + var(--boxel-button-min-height) +
              var(--boxel-sp-sm) + var(--boxel-sp-xs) * 2
          );
          z-index: 1;
          width: 75%;
          background-color: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius);
          box-shadow: var(--boxel-deep-box-shadow);
        }
        .thumbnail-editor {
          position: relative;
          padding: var(--boxel-sp-lg);
        }
        .thumbnail-editor-close-button {
          position: absolute;
          top: 0;
          right: 0;
        }
      }
    </style>
  </template>

  @tracked private isThumbnailEditorVisible = false;

  private toggleThumbnailEditor = () => {
    this.isThumbnailEditorVisible = !this.isThumbnailEditorVisible;
  };
  private closeThumbnailEditor = () => {
    this.isThumbnailEditorVisible = false;
  };
}
