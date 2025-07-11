import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { TrackedSet } from 'tracked-built-ins';

import { Tooltip, Pill } from '@cardstack/boxel-ui/components';
import { and, gt, not } from '@cardstack/boxel-ui/helpers';

import { localId, isCardInstance } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';

const MAX_ITEMS_TO_DISPLAY = 4;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    items: (CardDef | FileDef)[];
    autoAttachedCardIds?: TrackedSet<string>;
    autoAttachedFile?: FileDef;
    removeCard: (cardId: string) => void;
    removeFile: (file: FileDef) => void;
    isLoaded: boolean;
    autoAttachedCardTooltipMessage?: string;
  };
}

export default class AttachedItems extends Component<Signature> {
  @tracked areAllItemsDisplayed = false;

  get itemsToDisplay() {
    return this.areAllItemsDisplayed
      ? this.args.items
      : this.args.items.slice(0, MAX_ITEMS_TO_DISPLAY);
  }

  private isCard = (item: CardDef | FileDef): item is CardDef => {
    return isCardInstance(item);
  };

  private isAutoAttachedCard = (card: CardDef): boolean => {
    return this.args.autoAttachedCardIds?.has(card.id) ?? false;
  };

  private isAutoAttachedFile = (file: FileDef): boolean => {
    return this.args.autoAttachedFile?.sourceUrl === file.sourceUrl;
  };

  @action
  private toggleViewAllAttachedCards() {
    this.areAllItemsDisplayed = !this.areAllItemsDisplayed;
  }

  <template>
    <div class='attached-items'>
      {{#if @isLoaded}}
        {{#each this.itemsToDisplay as |item|}}
          {{#if (this.isCard item)}}
            {{#if (this.isAutoAttachedCard item)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <CardPill
                    @cardId={{idFor item}}
                    @isAutoAttachedCard={{true}}
                    @removeCard={{@removeCard}}
                    @urlForRealmLookup={{urlForRealmLookup item}}
                  />
                </:trigger>

                <:content>
                  {{#if @autoAttachedCardTooltipMessage}}
                    {{@autoAttachedCardTooltipMessage}}
                  {{else if (this.isAutoAttachedCard item)}}
                    Topmost card is shared automatically
                  {{/if}}
                </:content>
              </Tooltip>
            {{else}}
              <CardPill
                @cardId={{idFor item}}
                @isAutoAttachedCard={{false}}
                @removeCard={{@removeCard}}
                @urlForRealmLookup={{urlForRealmLookup item}}
              />
            {{/if}}
          {{else}}
            {{#if (this.isAutoAttachedFile item)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <FilePill
                    @file={{item}}
                    @isAutoAttachedFile={{true}}
                    @removeFile={{@removeFile}}
                  />
                </:trigger>
                <:content>
                  Currently opened file is shared automatically
                </:content>
              </Tooltip>
            {{else}}
              <FilePill
                @file={{item}}
                @isAutoAttachedFile={{false}}
                @removeFile={{@removeFile}}
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
      {{/if}}
    </div>
    <style scoped>
      .attached-items {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}

function idFor(instance: CardDef) {
  return instance.id ?? instance[localId];
}
