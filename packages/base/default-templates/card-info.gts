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

import { startCase } from 'lodash-es';

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
    <div class='card-info-editor'>
      <div class='card-info-preview-group'>
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
              class='preview-field'
              @label='Card Type'
              @icon={{@model.constructor.icon}}
              data-test-edit-preview='cardType'
            >
              {{@model.constructor.displayName}}
            </FieldContainer>
            {{#each this.previewFields as |item|}}
              {{#let item.Field as |Field|}}
                <FieldContainer
                  class='preview-field'
                  @label={{item.label}}
                  @icon={{if
                    (eq item.key 'cardThumbnailURL')
                    LinkIcon
                    (getFieldIcon @model item.key)
                  }}
                  data-test-edit-preview={{item.key}}
                  data-edit-preview-field={{item.key}}
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
      </div>
      <div class='card-info-fields'>
        <CardInfoImageContainer
          class='card-info-thumbnail-preview'
          @cardThumbnailURL={{@model.cardThumbnailURL}}
          @icon={{@model.constructor.icon}}
          data-test-thumbnail-image
        />
        <div class='card-info-edit-fields card-info-edit-field-group'>
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
        <Button
          class='card-info-thumbnail-popup-toggle'
          @size='extra-small'
          @kind='secondary-light'
          {{on 'click' this.toggleThumbnailEditor}}
          data-test-toggle-thumbnail-editor
        >
          Change
          {{#unless @hideThemeChooser}}Theme & {{/unless}}Thumbnail
        </Button>
        {{#if this.isThumbnailEditorVisible}}
          <div class='hidden-fields card-info-edit-field-group'>
            <FieldContainer
              class='card-info-field'
              @label='Thumbnail URL'
              @tag='label'
              @icon={{ImageIcon}}
              data-test-field='cardInfo-thumbnailURL'
            >
              <div class='thumbnail-picker' data-thumbnail-picker-controls>
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
    </div>
    <style scoped>
      .card-info-editor {
        container-name: card-info-editor-template;
        container-type: inline-size;
        position: relative;
        width: 100%;
        max-width: 100%;
      }

      .card-info-preview-group {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .preview-toggle {
        margin-left: auto;
        min-width: 10.5rem;
        justify-content: space-between;
      }
      .preview-toggle-icon {
        transform: rotate(90deg);
      }
      .is-preview-visible .preview-toggle-icon {
        transform: rotate(-90deg);
      }
      .default-preview {
        display: grid;
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp-xl);
        padding: var(--boxel-sp-lg);
        background-color: var(--accent);
        border-radius: var(--radius);
        color: var(--accent-foreground);
      }
      .preview-field,
      .preview-field > :deep(.label-container) {
        --boxel-field-content-padding: 0;
        min-height: unset;
        padding-top: unset;
      }

      .card-info-fields {
        --thumbnail-container-size: 6.25rem;
        display: grid;
        grid-template-areas:
          'thumbnail name-summary'
          'thumbnail-toggle name-summary'
          'hidden-fields hidden-fields';
        grid-template-columns:
          var(--boxel-field-label-size, minmax(8rem, 25%))
          1fr;
        align-items: center;
        justify-items: center;
      }
      .card-info-thumbnail-preview {
        grid-area: thumbnail;
        border: 1px solid var(--border);
      }
      .card-info-thumbnail-popup-toggle {
        grid-area: thumbnail-toggle;
        max-width: 9.375rem;
        margin-inline: var(--boxel-sp-xs);
        padding-inline: var(--boxel-sp-xs);
      }
      .card-info-edit-fields {
        grid-area: name-summary;
      }
      .hidden-fields {
        grid-area: hidden-fields;
        margin-top: var(--boxel-sp);
      }
      .card-info-edit-field-group {
        width: 100%;
        display: grid;
        gap: var(--boxel-sp-lg);
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
      .default-preview :deep([data-edit-preview-field='cardThumbnailURL']) {
        overflow-wrap: anywhere;
        min-width: 0;
      }

      @container card-info-editor-template (width < 425px) {
        .card-info-preview-group {
          margin-bottom: var(--boxel-sp);
        }
        .default-preview {
          margin-bottom: 0;
        }
        .card-info-fields {
          --thumbnail-container-size: 4.375rem;
          grid-template-columns: var(--thumbnail-container-size) 1fr;
          gap: var(--boxel-sp-sm);
          align-items: flex-end;
        }
        .card-info-edit-field-group {
          gap: var(--boxel-sp-xs);
        }
        .card-info-thumbnail-popup-toggle {
          align-self: start;
          max-width: var(--thumbnail-container-size);
          min-width: unset;
          margin-inline: 0;
          padding-inline: 0;
          border-radius: var(--boxel-border-radius-sm);
          font-size: 0.6875rem;
        }
        .card-info-thumbnail-preview :deep(.icon) {
          width: 1.25rem;
          height: 1.25rem;
        }
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
