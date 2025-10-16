import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import CaptionsIcon from '@cardstack/boxel-icons/captions';
import NameIcon from '@cardstack/boxel-icons/folder-pen';
import SummaryIcon from '@cardstack/boxel-icons/notepad-text';
import LinkIcon from '@cardstack/boxel-icons/link';
import ThemeIcon from '@cardstack/boxel-icons/palette';

import type { CardOrFieldTypeIcon, CardDef, FieldsTypeFor } from '../card-api';

import setBackgroundImage from '../helpers/set-background-image';

import { FieldContainer, Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { ChevronRight } from '@cardstack/boxel-ui/icons';

import { getFieldIcon } from '@cardstack/runtime-common';

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
    fields?: FieldsTypeFor<CardDef>;
    model?: CardDef;
    hideThemeChooser?: boolean;
  };
}

class CardInfoEditor extends GlimmerComponent<EditSignature> {
  <template>
    <div class='cardInfo-editor'>
      <Button
        class={{cn 'preview-toggle' is-preview-visible=this.isPreviewVisible}}
        @size='extra-small'
        @kind='text-only'
        {{on 'click' this.togglePreview}}
        data-test-toggle-preview
      >
        {{if this.isPreviewVisible 'Hide' 'Show'}}
        Default Preview
        <ChevronRight
          class='preview-toggle-icon'
          width='14'
          height='14'
          role='presentation'
        />
      </Button>
      {{#if this.isPreviewVisible}}
        <div class='default-preview'>
          <FieldContainer
            @label='Card Type'
            @icon={{CaptionsIcon}}
            data-test-edit-preview='cardType'
          >
            {{@model.constructor.displayName}}
          </FieldContainer>
          <FieldContainer
            @label='Title'
            @icon={{getFieldIcon @model 'title'}}
            data-test-edit-preview='cardTitle'
          >
            <@fields.title @format='embedded' />
          </FieldContainer>
          <FieldContainer
            @label='Description'
            @icon={{getFieldIcon @model 'description'}}
            data-test-edit-preview='cardDescription'
          >
            <@fields.description @format='embedded' />
          </FieldContainer>
          <FieldContainer
            @label='Thumbnail URL'
            @icon={{LinkIcon}}
            data-test-edit-preview='cardThumbnailURL'
          >
            <@fields.thumbnailURL @format='embedded' />
          </FieldContainer>
        </div>
      {{/if}}
      <FieldContainer class='main-fields'>
        <:label>
          <div class='cardInfo-thumbnail-container'>
            <CardInfoImageContainer
              class='cardInfo-thumbnail-preview'
              @thumbnailURL={{@model.cardInfo.thumbnailURL}}
              @icon={{@model.constructor.icon}}
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
              <@fields.cardInfo.title />
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
              <@fields.cardInfo.description />
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
            <div class='thumbnail-input-container'>
              {{#if this.showThumbnailPlaceholder}}
                <span class='thumbnail-placeholder'>
                  <@fields.thumbnailURL />
                </span>
              {{/if}}
              <@fields.cardInfo.thumbnailURL />
            </div>
          </FieldContainer>
          {{#unless @hideThemeChooser}}
            <FieldContainer
              class='card-info-field theme-field'
              @label='Theme'
              @icon={{ThemeIcon}}
              data-test-field='cardInfo-theme'
            >
              <@fields.cardInfo.theme />
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
      .preview-toggle {
        position: absolute;
        top: calc(-1 * var(--boxel-sp-sm));
        right: 0;
        min-width: 9.5rem;
        justify-content: space-between;
        padding: var(--boxel-sp-4xs);
      }
      .preview-toggle-icon {
        transform: rotate(90deg);
      }
      .is-preview-visible .preview-toggle-icon {
        transform: rotate(-90deg);
      }
      .preview-toggle + .default-preview {
        margin-top: var(--boxel-sp-lg);
      }
      .default-preview + .main-fields {
        margin-top: var(--boxel-sp-lg);
      }
      .default-preview {
        padding: var(--boxel-sp-lg);
        background-color: var(--accent, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        color: var(--accent-foreground, var(--boxel-dark));
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
      .thumbnail-input-container {
        position: relative;
      }
      .thumbnail-placeholder :deep(input) {
        position: absolute;
        left: 0;
        right: 0;
        width: 99%;
        padding-block: 0;
        background: none;
        border: none;
      }
    </style>
  </template>

  @tracked private isPreviewVisible = false;
  @tracked private isThumbnailEditorVisible = false;

  private togglePreview = () => {
    this.isPreviewVisible = !this.isPreviewVisible;
  };

  private toggleThumbnailEditor = () => {
    this.isThumbnailEditorVisible = !this.isThumbnailEditorVisible;
  };

  private get showThumbnailPlaceholder() {
    return (
      !this.args.model?.cardInfo?.thumbnailURL && this.args.model?.thumbnailURL
    );
  }
}

const CardInfoTemplates = {
  view: CardInfoView,
  edit: CardInfoEditor,
};

export default CardInfoTemplates;
