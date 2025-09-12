import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import CardInfoNameIcon from '@cardstack/boxel-icons/folder-pen';
import CardInfoSummaryIcon from '@cardstack/boxel-icons/notepad-text';
import ThemeIcon from '@cardstack/boxel-icons/palette';

import type { CardOrFieldTypeIcon, CardInfoField } from '../card-api';

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

interface ViewSignature {
  Args: {
    title?: string;
    description?: string;
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
}

class CardInfoView extends GlimmerComponent<ViewSignature> {
  <template>
    <CardInfoImageContainer
      class='image-container'
      @thumbnailURL={{@thumbnailURL}}
      @icon={{@icon}}
      data-test-field='cardThumbnailURL'
    />
    <div class='info'>
      <h2 class='card-info-title' data-test-field='cardTitle'>{{@title}}</h2>
      <p class='card-info-description' data-test-field='cardDescription'>
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

interface EditSignature {
  Args: {
    icon?: CardOrFieldTypeIcon;
    fields?: Record<string, new () => GlimmerComponent>;
    model?: CardInfoField;
  };
}

class CardInfoEditor extends GlimmerComponent<EditSignature> {
  <template>
    <FieldContainer class='cardInfo-editor'>
      <:label>
        <div class='cardInfo-thumbnail-container'>
          <CardInfoImageContainer
            class='cardInfo-thumbnail-preview'
            @thumbnailURL={{@model.thumbnailURL}}
            @icon={{@icon}}
            data-test-thumbnail-image
          />
          <Button
            class='cardInfo-thumbnail-popup-toggle'
            @size='extra-small'
            @kind='secondary-light'
            {{on 'click' this.toggleThumbnailEditor}}
            data-test-toggle-thumbnail-editor
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
                  data-test-close-thumbnail-editor
                />
                <FieldContainer
                  @label='Thumbnail URL'
                  @tag='label'
                  @vertical={{true}}
                  @labelFontSize='small'
                  data-test-field='cardInfo-thumbnailURL'
                >
                  <@fields.thumbnailURL />
                </FieldContainer>
              </div>
            </div>
          {{/if}}
        </div>
      </:label>
      <:default>
        <div class='card-info-edit-fields'>
          <FieldContainer
            class='card-info-field'
            @label='Name'
            @tag='label'
            @labelFontSize='default'
            @icon={{CardInfoNameIcon}}
            @vertical={{true}}
            data-test-field='cardInfo-name'
          >
            <@fields.title />
          </FieldContainer>
          <FieldContainer
            class='card-info-field'
            @label='Summary'
            @tag='label'
            @labelFontSize='default'
            @icon={{CardInfoSummaryIcon}}
            @vertical={{true}}
            data-test-field='cardInfo-summary'
          >
            <@fields.description />
          </FieldContainer>
          <FieldContainer
            class='card-info-field'
            @label='Theme'
            @tag='label'
            @labelFontSize='default'
            @icon={{ThemeIcon}}
            data-test-field='cardInfo-theme'
          >
            <@fields.theme />
          </FieldContainer>
        </div>
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
        .card-info-field + .card-info-field {
          margin-top: var(--boxel-sp-lg);
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

const CardInfoTemplates = {
  view: CardInfoView,
  edit: CardInfoEditor,
};

export default CardInfoTemplates;
