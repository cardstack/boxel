import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Tooltip, Pill } from '@cardstack/boxel-ui/components';
import { and, eq, gt, not } from '@cardstack/boxel-ui/helpers';

import type { CardErrorJSONAPI } from '@cardstack/runtime-common';
import {
  localId,
  isCardInstance,
  isCardErrorJSONAPI,
} from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import type { DraftFileUpload } from './types';
import type { TrackedSet } from 'tracked-built-ins';

const MAX_ITEMS_TO_DISPLAY = 4;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    items: (CardDef | FileDef | CardErrorJSONAPI)[];
    autoAttachedCardIds?: TrackedSet<string>;
    autoAttachedFiles?: FileDef[];
    removeCard: (cardId: string) => void;
    removeFile: (file: FileDef) => void;
    chooseCard?: (cardId: string) => void;
    chooseFile?: (file: FileDef) => void;
    pendingUploads?: DraftFileUpload[];
    retryFileUpload?: (uploadId: string) => void;
    removePendingFileUpload?: (uploadId: string) => void;
    isLoaded: boolean;
    autoAttachedCardTooltipMessage?: string;
  };
}

export default class AttachedItems extends Component<Signature> {
  @tracked areAllItemsDisplayed = false;

  @service declare private operatorModeStateService: OperatorModeStateService;

  get itemsToDisplay() {
    return this.areAllItemsDisplayed
      ? this.args.items
      : this.args.items.slice(0, MAX_ITEMS_TO_DISPLAY);
  }

  get pendingUploads() {
    return this.args.pendingUploads ?? [];
  }

  private isCard = (item: CardDef | FileDef): item is CardDef => {
    return isCardInstance(item);
  };

  private isAutoAttachedCard = (cardId: string): boolean => {
    return this.args.autoAttachedCardIds?.has(cardId) ?? false;
  };

  private isAutoAttachedFile = (file: FileDef): boolean => {
    return (
      this.args.autoAttachedFiles?.some(
        (autoFile) => autoFile.sourceUrl === file.sourceUrl,
      ) ?? false
    );
  };

  @action
  private toggleViewAllAttachedCards() {
    this.areAllItemsDisplayed = !this.areAllItemsDisplayed;
  }

  private getCardErrorId(cardError: CardErrorJSONAPI) {
    return cardError.id ?? '';
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

  @action
  private retryFileUpload(uploadId: string) {
    this.args.retryFileUpload?.(uploadId);
  }

  @action
  private removePendingFileUpload(uploadId: string) {
    this.args.removePendingFileUpload?.(uploadId);
  }

  <template>
    <div class='attached-items' ...attributes>
      {{#if @isLoaded}}
        {{#each this.itemsToDisplay as |item|}}
          {{#if (isCardErrorJSONAPI item)}}
            {{#if (this.isAutoAttachedCard (this.getCardErrorId item))}}
              <Tooltip @placement='top'>
                <:trigger>
                  <CardPill
                    @cardId={{this.getCardErrorId item}}
                    @borderType='dashed'
                    @onClick={{fn
                      this.handleChooseCard
                      (this.getCardErrorId item)
                    }}
                    @onRemove={{fn
                      this.handleRemoveCard
                      (this.getCardErrorId item)
                    }}
                    @urlForRealmLookup={{this.getCardErrorRealm item}}
                    data-test-autoattached-card={{this.getCardErrorId item}}
                  />
                </:trigger>

                <:content>
                  {{#if @autoAttachedCardTooltipMessage}}
                    {{@autoAttachedCardTooltipMessage}}
                  {{else if
                    (this.isAutoAttachedCard (this.getCardErrorId item))
                  }}
                    Topmost card is shared automatically
                  {{/if}}
                </:content>
              </Tooltip>
            {{else}}
              <CardPill
                @cardId={{this.getCardErrorId item}}
                @borderType='solid'
                @onRemove={{fn
                  this.handleRemoveCard
                  (this.getCardErrorId item)
                }}
                @urlForRealmLookup={{this.getCardErrorRealm item}}
              />
            {{/if}}
          {{else if (this.isCard item)}}
            {{#if (this.isAutoAttachedCard item.id)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <CardPill
                    @cardId={{idFor item}}
                    @borderType='dashed'
                    @onClick={{fn this.handleChooseCard (idFor item)}}
                    @onRemove={{fn this.handleRemoveCard (idFor item)}}
                    @urlForRealmLookup={{urlForRealmLookup item}}
                    data-test-autoattached-card={{idFor item}}
                  />
                </:trigger>

                <:content>
                  {{#if @autoAttachedCardTooltipMessage}}
                    {{@autoAttachedCardTooltipMessage}}
                  {{else if (this.isAutoAttachedCard item.id)}}
                    Topmost card is shared automatically
                  {{/if}}
                </:content>
              </Tooltip>
            {{else}}
              <CardPill
                @cardId={{idFor item}}
                @borderType='solid'
                @onRemove={{fn this.handleRemoveCard (idFor item)}}
                @urlForRealmLookup={{urlForRealmLookup item}}
              />
            {{/if}}
          {{else}}
            {{#if (this.isAutoAttachedFile item)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <FilePill
                    @file={{item}}
                    @borderType='dashed'
                    @onClick={{fn this.handleChooseFile item}}
                    @onRemove={{fn this.handleRemoveFile item}}
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
              />
            {{/if}}
          {{/if}}
        {{/each}}
        {{#if
          (and
            (gt @items.length MAX_ITEMS_TO_DISPLAY)
            (not this.areAllItemsDisplayed)
          )
        }}
          <Pill
            @kind='button'
            {{on 'click' this.toggleViewAllAttachedCards}}
            data-test-view-all
          >
            View All ({{@items.length}})
          </Pill>
        {{/if}}
        {{#each this.pendingUploads as |upload|}}
          <Pill
            @kind='button'
            class='pending-upload-pill'
            data-test-pending-upload={{upload.id}}
          >
            <:iconLeft>
              {{#if (eq upload.state 'uploading')}}
                <span class='pending-upload-spinner' />
              {{/if}}
            </:iconLeft>
            <:default>
              <span class='pending-upload-name'>{{upload.file.name}}</span>
              {{#if (eq upload.state 'error')}}
                <span
                  class='pending-upload-error'
                  data-test-pending-upload-error={{upload.id}}
                >{{upload.error}}</span>
              {{/if}}
            </:default>
            <:iconRight>
              {{#if (eq upload.state 'error')}}
                <button
                  type='button'
                  class='pending-upload-retry'
                  {{on 'click' (fn this.retryFileUpload upload.id)}}
                  data-test-pending-upload-retry={{upload.id}}
                >
                  Retry
                </button>
              {{/if}}
              <button
                type='button'
                class='pending-upload-remove'
                {{on 'click' (fn this.removePendingFileUpload upload.id)}}
                data-test-pending-upload-remove={{upload.id}}
              >
                Remove
              </button>
            </:iconRight>
          </Pill>
        {{/each}}
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
      .pending-upload-pill {
        max-width: 100%;
      }
      .pending-upload-name {
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pending-upload-error {
        color: var(--boxel-error-200);
        margin-left: var(--boxel-sp-xxs);
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pending-upload-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid var(--boxel-300);
        border-top-color: var(--boxel-700);
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      .pending-upload-retry,
      .pending-upload-remove {
        border: none;
        background: transparent;
        padding: 0 var(--boxel-sp-3xs);
        cursor: pointer;
        font: var(--boxel-font-xs);
      }
      .pending-upload-retry {
        color: var(--boxel-dark);
      }
      .pending-upload-remove {
        color: var(--boxel-error-200);
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </template>
}

function idFor(instance: CardDef) {
  return instance.id ?? instance[localId];
}
