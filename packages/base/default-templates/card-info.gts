import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import NameIcon from '@cardstack/boxel-icons/folder-pen';
import SummaryIcon from '@cardstack/boxel-icons/notepad-text';
import LinkIcon from '@cardstack/boxel-icons/link';
import ImageIcon from '@cardstack/boxel-icons/image';
import ThemeIcon from '@cardstack/boxel-icons/palette';
import XIcon from '@cardstack/boxel-icons/x';

import type { CardOrFieldTypeIcon, CardDef, FieldsTypeFor } from '../card-api';
import { ImageDef } from '../card-api';

import setBackgroundImage from '../helpers/set-background-image';

import {
  FieldContainer,
  Button,
  IconButton,
} from '@cardstack/boxel-ui/components';
import { and, cn, eq } from '@cardstack/boxel-ui/helpers';
import { ChevronRight } from '@cardstack/boxel-ui/icons';

import { startCase } from 'lodash';

import {
  chooseFile,
  identifyCard,
  getFieldIcon,
  cardDefComputedFields,
} from '@cardstack/runtime-common';

class CardInfoImageContainer extends GlimmerComponent<{
  Args: {
    cardThumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
  Element: HTMLElement;
}> {
  <template>
    <div
      class='cardInfo-image-container thumbnail'
      style={{setBackgroundImage @cardThumbnailURL}}
      role='presentation'
      ...attributes
    >
      {{#unless @cardThumbnailURL}}
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
    cardTitle?: string;
    cardDescription?: string;
    cardThumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
}

class CardInfoView extends GlimmerComponent<ViewSignature> {
  <template>
    <CardInfoImageContainer
      class='image-container'
      @cardThumbnailURL={{@cardThumbnailURL}}
      @icon={{@icon}}
      data-test-field='cardInfo-thumbnailURL'
    />
    <div class='info'>
      <h2 class='card-info-title' data-test-field='cardInfo-name'>
        {{@cardTitle}}
      </h2>
      <p class='card-info-description' data-test-field='cardInfo-summary'>
        {{@cardDescription}}
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
            @icon={{@model.constructor.icon}}
            data-test-edit-preview='cardType'
          >
            {{@model.constructor.displayName}}
          </FieldContainer>
          {{#each this.previewFields as |item|}}
            {{#let item.Field as |Field|}}
              <FieldContainer
                @label={{item.label}}
                @icon={{if
                  (eq item.key 'cardThumbnailURL')
                  LinkIcon
                  (getFieldIcon @model item.key)
                }}
                data-test-edit-preview={{item.key}}
              >
                {{#if item.value}}
                  <Field @format='atom' />
                {{else}}
                  <em class='null-preview'>
                    {{#if (and (eq item.key 'cardTheme') @hideThemeChooser)}}
                      (Self)
                    {{else}}
                      None
                    {{/if}}
                  </em>
                {{/if}}
              </FieldContainer>
            {{/let}}
          {{/each}}
        </div>
      {{/if}}
      <FieldContainer class='main-fields'>
        <:label>
          <div class='cardInfo-thumbnail-container'>
            <CardInfoImageContainer
              class='cardInfo-thumbnail-preview'
              @cardThumbnailURL={{@model.cardThumbnailURL}}
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
              Change Thumbnail
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
              <@fields.cardInfo.name />
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
              <@fields.cardInfo.summary />
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
            @icon={{ImageIcon}}
            data-test-field='cardInfo-thumbnailURL'
          >
            <div
              class='thumbnail-picker'
              data-thumbnail-picker-controls
            >
              <div class='thumbnail-picker-inputs'>
                <span
                  class='thumbnail-picker-input-slot'
                  data-test-thumbnail-input
                >
                  <@fields.cardInfo.cardThumbnailURL />
                </span>
                {{#if this.hasThumbnailUrl}}
                  <IconButton
                    class='thumbnail-picker-clear'
                    @icon={{XIcon}}
                    @width='16px'
                    @height='16px'
                    aria-label='Clear thumbnail'
                    data-test-thumbnail-clear
                    {{on 'click' this.clearThumbnail}}
                  />
                {{else if this.computedThumbnailFallback}}
                  <span
                    class='thumbnail-picker-placeholder'
                    data-test-thumbnail-placeholder
                    aria-hidden='true'
                  >{{this.computedThumbnailFallback}}</span>
                {{/if}}
              </div>
              {{#unless this.hasThumbnailUrl}}
                <span class='thumbnail-picker-or'>or</span>
                <Button
                  @kind='secondary'
                  @size='extra-small'
                  data-test-thumbnail-select-image
                  {{on 'click' this.selectThumbnailImage}}
                >
                  Select Image
                </Button>
              {{/unless}}
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
        top: calc(-1 * var(--boxel-sp-lg));
        right: 0;
        min-width: 10.5rem;
        justify-content: space-between;
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
      .theme-field :deep(.links-to-editor .field-component-card) {
        min-height: var(--boxel-form-control-height);
      }
      .thumbnail-picker {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .thumbnail-picker-inputs {
        flex: 1;
        min-width: 0;
        position: relative;
      }
      .thumbnail-picker-input-slot {
        display: block;
      }
      .thumbnail-picker-input-slot :deep(input) {
        width: 100%;
        padding-right: 2.5rem;
        text-overflow: ellipsis;
      }
      .thumbnail-picker-clear {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 100%;
        opacity: 0.5;
        z-index: 1;
      }
      .thumbnail-picker-clear:hover,
      .thumbnail-picker-clear:focus {
        opacity: 1;
        outline: 0;
      }
      .thumbnail-picker-placeholder {
        position: absolute;
        top: 0;
        left: var(--boxel-sp-sm);
        right: 2.5rem;
        height: 100%;
        display: flex;
        align-items: center;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--muted-foreground, var(--boxel-450));
        pointer-events: none;
      }
      .thumbnail-picker-or {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-400));
      }
      .null-preview {
        color: var(--muted-foreground, var(--boxel-450));
      }
      .default-preview :deep([data-test-edit-preview='cardThumbnailURL']) {
        overflow-wrap: anywhere;
        min-width: 0;
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

  private get previewFields() {
    return cardDefComputedFields.map((key) => ({
      key,
      label: startCase(key),
      value: (this.args.model as any)?.[key],
      Field: (this.args.fields as any)?.[key],
    }));
  }

  private get hasThumbnailUrl() {
    return Boolean(this.args.model?.cardInfo?.cardThumbnailURL);
  }

  private get computedThumbnailFallback() {
    let cardInfo = this.args.model?.cardInfo;
    if (cardInfo?.cardThumbnailURL) {
      return undefined;
    }
    return this.args.model?.cardThumbnailURL;
  }

  private clearThumbnail = () => {
    let cardInfo = this.args.model?.cardInfo as
      | { cardThumbnailURL: string | null }
      | undefined;
    if (cardInfo) {
      cardInfo.cardThumbnailURL = null;
    }
  };

  private selectThumbnailImage = async () => {
    let cardInfo = this.args.model?.cardInfo;
    if (!cardInfo) {
      return;
    }
    let imageRef = identifyCard(ImageDef);
    let file = await chooseFile<InstanceType<typeof ImageDef>>(
      imageRef ? { fileType: imageRef, fileTypeName: 'Image' } : undefined,
    );
    if (file?.url) {
      cardInfo.cardThumbnailURL = file.url;
      // Preserve the linked image relationship so cardInfo.cardThumbnail
      // reflects the chosen ImageDef as well
      if (file.id) {
        cardInfo.cardThumbnail = file;
      }
    }
  };
}

const CardInfoTemplates = {
  view: CardInfoView,
  edit: CardInfoEditor,
};

export default CardInfoTemplates;
