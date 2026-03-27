import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Tooltip, Pill, RealmIcon } from '@cardstack/boxel-ui/components';
import { and, gt, not } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import type { CardErrorJSONAPI } from '@cardstack/runtime-common';
import {
  localId,
  isCardInstance,
  isCardErrorJSONAPI,
} from '@cardstack/runtime-common';

import {
  requiredModality,
  modalityLabel,
  isTextBasedContentType,
} from '@cardstack/runtime-common/ai/modality';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';
import type { PrerenderedCard } from '@cardstack/host/components/prerendered-card-search';
import type {
  FileUploadState,
  FileUploadStatus,
} from '@cardstack/host/lib/file-upload-state';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import type { TrackedSet } from 'tracked-built-ins';

const MAX_ITEMS_TO_DISPLAY = 4;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    items: (CardDef | FileDef | CardErrorJSONAPI)[];
    autoAttachedCardIds?: TrackedSet<string>;
    autoAttachedPrerenderedCards?: PrerenderedCard[];
    autoAttachedFiles?: FileDef[];
    removeCard: (cardId: string) => void;
    removeFile: (file: FileDef) => void;
    chooseCard?: (cardId: string) => void;
    chooseFile?: (file: FileDef) => void;
    isLoaded: boolean;
    autoAttachedCardTooltipMessage?: string;
    fileUploadStates?: ReadonlyMap<string, FileUploadState>;
    retryFileUpload?: (file: FileDef) => void;
    inputModalities?: string[];
  };
}

export default class AttachedItems extends Component<Signature> {
  @tracked areAllItemsDisplayed = false;

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  private get allItemsCount() {
    let autoCount = this.args.autoAttachedPrerenderedCards?.length ?? 0;
    return this.args.items.length + autoCount;
  }

  private get allItemsToDisplay() {
    let autoCards = this.args.autoAttachedPrerenderedCards ?? [];
    let items = this.args.items;
    let total = autoCards.length + items.length;

    if (this.areAllItemsDisplayed || total <= MAX_ITEMS_TO_DISPLAY) {
      return { autoCards, items };
    }

    // Show auto-attached cards first, then fill remaining with items
    let remaining = MAX_ITEMS_TO_DISPLAY;
    let displayedAutoCards = autoCards.slice(0, remaining);
    remaining -= displayedAutoCards.length;
    let displayedItems = remaining > 0 ? items.slice(0, remaining) : [];
    return { autoCards: displayedAutoCards, items: displayedItems };
  }

  private isCard = (item: CardDef | FileDef): item is CardDef => {
    return isCardInstance(item);
  };

  private isAutoAttachedFile = (file: FileDef): boolean => {
    return (
      this.args.autoAttachedFiles?.some(
        (autoFile) => autoFile.sourceUrl === file.sourceUrl,
      ) ?? false
    );
  };

  private getPrerenderedCardTitle = (card: PrerenderedCard): string => {
    // Extract text content from atom HTML. The atom template renders the card title.
    if (!card.data.html) {
      return card.url.split('/').pop() ?? 'Card';
    }
    let parser = new DOMParser();
    let doc = parser.parseFromString(card.data.html, 'text/html');
    return doc.body.textContent?.trim() || card.url.split('/').pop() || 'Card';
  };

  @action
  private toggleViewAllAttachedCards() {
    this.areAllItemsDisplayed = !this.areAllItemsDisplayed;
  }

  private getCardErrorRealm(cardError: CardErrorJSONAPI) {
    return cardError.realm ?? this.operatorModeStateService.realmURL;
  }

  @action
  private handleRemoveCard(cardId: string) {
    this.args.removeCard(cardId);
  }

  @action
  private handleChooseCard(cardId: string) {
    if (this.args.chooseCard) {
      this.args.chooseCard(cardId);
    }
  }

  @action
  private handleChooseFile(file: FileDef) {
    if (this.args.chooseFile) {
      this.args.chooseFile(file);
    }
  }

  @action
  private handleRemoveFile(file: FileDef) {
    this.args.removeFile(file);
  }

  private getUploadStatus = (file: FileDef): FileUploadStatus | undefined => {
    let sourceUrl = file.sourceUrl;
    if (!sourceUrl) {
      return undefined;
    }
    return this.args.fileUploadStates?.get(sourceUrl)?.status;
  };

  private getModalityWarning = (file: FileDef): string | undefined => {
    let modality = requiredModality(file.contentType);
    if (modality) {
      // Multimodal type — warn only if model doesn't support it
      let modalities = this.args.inputModalities;
      if (modalities && !modalities.includes(modality)) {
        return `Model does not support ${modalityLabel(modality)}. Only metadata will be sent.`;
      }
      return undefined;
    }
    // Non-multimodal, non-text files only get metadata sent
    if (!isTextBasedContentType(file.contentType)) {
      return 'File type not supported. Will send file metadata only.';
    }
    return undefined;
  };

  <template>
    <div class='attached-items' ...attributes>
      {{#if @isLoaded}}
        {{! Auto-attached cards rendered from prerendered HTML (no full card module loading) }}
        {{#each this.allItemsToDisplay.autoCards as |card|}}
          <Tooltip @placement='top'>
            <:trigger>
              <Pill
                @kind='button'
                class='card-pill border-dashed'
                data-test-attached-card={{card.url}}
                data-test-autoattached-card={{card.url}}
                {{on 'click' (fn this.handleChooseCard card.url)}}
              >
                <:iconLeft>
                  <RealmIcon
                    @realmInfo={{this.realm.info card.data.realmUrl}}
                  />
                </:iconLeft>
                <:default>
                  <div
                    class='card-content'
                    title={{this.getPrerenderedCardTitle card}}
                  >
                    {{this.getPrerenderedCardTitle card}}
                  </div>
                </:default>
                <:iconRight>
                  <button
                    class='remove-button'
                    type='button'
                    {{on 'click' (fn this.handleRemoveCard card.url)}}
                    data-test-remove-card-btn
                  >
                    <IconX width='10' height='10' />
                  </button>
                </:iconRight>
              </Pill>
            </:trigger>

            <:content>
              {{#if @autoAttachedCardTooltipMessage}}
                {{@autoAttachedCardTooltipMessage}}
              {{else}}
                Topmost card is shared automatically
              {{/if}}
            </:content>
          </Tooltip>
        {{/each}}
        {{! Manually attached cards and files (loaded via getCardCollection) }}
        {{#each this.allItemsToDisplay.items as |item|}}
          {{#if (isCardErrorJSONAPI item)}}
            {{#if item.id}}
              <CardPill
                @cardId={{item.id}}
                @borderType='solid'
                @onRemove={{fn this.handleRemoveCard item.id}}
                @urlForRealmLookup={{this.getCardErrorRealm item}}
              />
            {{/if}}
          {{else if (this.isCard item)}}
            <CardPill
              @cardId={{idFor item}}
              @borderType='solid'
              @onRemove={{fn this.handleRemoveCard (idFor item)}}
              @urlForRealmLookup={{urlForRealmLookup item}}
            />
          {{else}}
            {{#if (this.isAutoAttachedFile item)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <FilePill
                    @file={{item}}
                    @borderType='dashed'
                    @onClick={{fn this.handleChooseFile item}}
                    @onRemove={{fn this.handleRemoveFile item}}
                    @uploadStatus={{this.getUploadStatus item}}
                    @onRetry={{if @retryFileUpload (fn @retryFileUpload item)}}
                    @warningMessage={{this.getModalityWarning item}}
                    data-test-autoattached-file={{item.sourceUrl}}
                  />
                </:trigger>
                <:content>
                  Currently opened file is shared automatically
                </:content>
              </Tooltip>
            {{else}}
              <FilePill
                @file={{item}}
                @borderType='solid'
                @onRemove={{fn this.handleRemoveFile item}}
                @uploadStatus={{this.getUploadStatus item}}
                @onRetry={{if @retryFileUpload (fn @retryFileUpload item)}}
                @warningMessage={{this.getModalityWarning item}}
              />
            {{/if}}
          {{/if}}
        {{/each}}
        {{#if
          (and
            (gt this.allItemsCount MAX_ITEMS_TO_DISPLAY)
            (not this.areAllItemsDisplayed)
          )
        }}
          <Pill
            @kind='button'
            {{on 'click' this.toggleViewAllAttachedCards}}
            data-test-view-all
          >
            View All ({{this.allItemsCount}})
          </Pill>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .attached-items {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
      }
      .card-pill {
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: 18px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
        overflow: hidden;
      }
      .border-dashed {
        border-style: dashed;
      }
      .card-content {
        max-width: 100px;
        max-height: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remove-button {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>
}

function idFor(instance: CardDef) {
  return instance.id ?? instance[localId];
}
