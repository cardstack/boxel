import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import NameIcon from '@cardstack/boxel-icons/folder-pen';
import SummaryIcon from '@cardstack/boxel-icons/notepad-text';
import LinkIcon from '@cardstack/boxel-icons/link';
import ThemeIcon from '@cardstack/boxel-icons/palette';

import type { CardOrFieldTypeIcon, CardInfoField } from '../card-api';

import setBackgroundImage from '../helpers/set-background-image';

import { FieldContainer, Button } from '@cardstack/boxel-ui/components';

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
    </style>
  </template>
}

interface EditSignature {
  Args: {
    icon?: CardOrFieldTypeIcon;
    fields?: Record<string, new () => GlimmerComponent>;
    model?: CardInfoField;
    hideThemeChooser?: boolean;
  };
}

class CardInfoEditor extends GlimmerComponent<EditSignature> {
  <template>
    <div class='cardInfo-editor'>
      <FieldContainer>
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
              {{#unless @hideThemeChooser}}& Theme{{/unless}}
            </Button>
          </div>
        </:label>
        <:default>
          <div class='card-info-edit-fields'>
            <FieldContainer
              class='card-info-field'
              @label='Name'
              @tag='label'
              @labelFontSize='default'
              @icon={{NameIcon}}
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
              @icon={{SummaryIcon}}
              @vertical={{true}}
              data-test-field='cardInfo-summary'
            >
              <@fields.description />
            </FieldContainer>
          </div>
        </:default>
      </FieldContainer>
      {{#if this.isThumbnailEditorVisible}}
        <div class='hidden-fields'>
          <FieldContainer
            class='card-info-field'
            @label='Thumbnail URL'
            @tag='label'
            @icon={{LinkIcon}}
            data-test-field='cardInfo-thumbnailURL'
          >
            <@fields.thumbnailURL />
          </FieldContainer>
          {{#unless @hideThemeChooser}}
            <FieldContainer
              class='card-info-field theme-field'
              @label='Theme'
              @tag='label'
              @icon={{ThemeIcon}}
              data-test-field='cardInfo-theme'
            >
              <@fields.theme />
            </FieldContainer>
          {{/unless}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .cardInfo-editor {
        --thumbnail-container-size: 6.25rem;
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
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
      }
      .cardInfo-thumbnail-popup-toggle {
        margin-top: var(--boxel-sp-xs);
      }
      .card-info-field + .card-info-field {
        margin-top: var(--boxel-sp-lg);
      }
      .hidden-fields {
        margin-top: var(--boxel-sp);
      }
      .theme-field :deep(.links-to-editor .field-component-card),
      .theme-field :deep(.add-button--full-width) {
        min-height: var(--boxel-form-control-height);
      }
    </style>
  </template>

  @tracked private isThumbnailEditorVisible = false;

  private toggleThumbnailEditor = () => {
    this.isThumbnailEditorVisible = !this.isThumbnailEditorVisible;
  };
}

const CardInfoTemplates = {
  view: CardInfoView,
  edit: CardInfoEditor,
};

export default CardInfoTemplates;
