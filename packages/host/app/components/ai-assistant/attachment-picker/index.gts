import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { consume } from 'ember-provide-consume-context';

import { TrackedSet } from 'tracked-built-ins';

import { AddButton, Tooltip, Pill } from '@cardstack/boxel-ui/components';
import { and, cn, eq, gt, not } from '@cardstack/boxel-ui/helpers';

import {
  chooseCard,
  baseCardRef,
  isCardInstance,
  chooseFile,
  GetCardCollectionContextName,
  type getCardCollection,
} from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';
import consumeContext from '@cardstack/host/helpers/consume-context';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';

import { Submode } from '../../submode-switcher';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    autoAttachedCardIds?: TrackedSet<string>;
    cardIdsToAttach: string[] | undefined;
    autoAttachedFile?: FileDef;
    filesToAttach: FileDef[] | undefined;
    chooseCard: (cardId: string) => void;
    removeCard: (cardId: string) => void;
    chooseFile: (file: FileDef) => void;
    removeFile: (file: FileDef) => void;
    submode: Submode;
    maxNumberOfItemsToAttach?: number;
    autoAttachedCardTooltipMessage?: string;
  };
}

const MAX_ITEMS_TO_DISPLAY = 4;

export default class AiAssistantAttachmentPicker extends Component<Signature> {
  <template>
    {{consumeContext this.makeCardResources}}
    <div class='item-picker'>
      {{#if this.isLoaded}}
        {{#each this.itemsToDisplay as |item|}}
          {{#if (this.isCard item)}}
            {{#if (this.isAutoAttachedCard item)}}
              <Tooltip @placement='top'>
                <:trigger>
                  <CardPill
                    @cardId={{item.id}}
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
                @cardId={{item.id}}
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
            (gt this.items.length MAX_ITEMS_TO_DISPLAY)
            (not this.areAllItemsDisplayed)
          )
        }}
          <Pill
            @kind='button'
            {{on 'click' this.toggleViewAllAttachedCards}}
            data-test-view-all
          >
            View All ({{this.items.length}})
          </Pill>
        {{/if}}
        {{#if this.canDisplayAddButton}}
          {{#if (eq @submode 'code')}}
            <AddButton
              class={{cn 'attach-button' icon-only=this.files.length}}
              @variant='pill'
              @iconWidth='14'
              @iconHeight='14'
              {{on 'click' this.chooseFile}}
              @disabled={{this.doChooseFile.isRunning}}
              data-test-choose-file-btn
            >
              <span class={{if this.files.length 'boxel-sr-only'}}>
                Attach File
              </span>
            </AddButton>
          {{else}}
            <AddButton
              class={{cn 'attach-button' icon-only=this.cards.length}}
              @variant='pill'
              @iconWidth='14'
              @iconHeight='14'
              {{on 'click' this.chooseCard}}
              @disabled={{this.chooseCardTask.isRunning}}
              data-test-choose-card-btn
            >
              <span class={{if this.cards.length 'boxel-sr-only'}}>
                Add Card
              </span>
            </AddButton>
          {{/if}}
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .item-picker {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-xxs);
      }
      .attach-button {
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        height: var(--pill-height);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xxxs);
        gap: var(--boxel-sp-xs);
        background: none;
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
        background: none;
        box-shadow: none;
      }
      .attach-button.icon-only {
        width: 30px;
        height: var(--pill-height, 30px);
      }
      .attach-button > :deep(svg > path) {
        stroke: none;
      }
    </style>
  </template>

  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @tracked areAllItemsDisplayed = false;
  @tracked private cardCollection: ReturnType<getCardCollection> | undefined;

  @action
  private toggleViewAllAttachedCards() {
    this.areAllItemsDisplayed = !this.areAllItemsDisplayed;
  }

  private makeCardResources = () => {
    this.cardCollection = this.getCardCollection(this, () => this.cardIds);
  };

  private isCard = (item: CardDef | FileDef): item is CardDef => {
    return isCardInstance(item);
  };

  private isAutoAttachedCard = (card: CardDef) => {
    return this.args.autoAttachedCardIds?.has(card.id);
  };

  private isAutoAttachedFile = (file: FileDef) => {
    return this.args.autoAttachedFile?.sourceUrl === file.sourceUrl;
  };

  private get items() {
    return [...this.cards, ...this.files];
  }

  private get isLoaded() {
    return this.cardCollection?.isLoaded;
  }

  private get cards() {
    return this.cardCollection?.cards ?? [];
  }

  private get cardIds() {
    let cardIds = this.args.cardIdsToAttach ?? [];

    if (this.args.autoAttachedCardIds) {
      cardIds = [...new Set([...this.args.autoAttachedCardIds, ...cardIds])];
    }

    cardIds = cardIds.filter(Boolean); // Dont show new unsaved cards
    return cardIds;
  }

  private get files() {
    let files = this.args.filesToAttach ?? [];

    if (this.args.autoAttachedFile) {
      files = [...new Set([this.args.autoAttachedFile, ...files])];
    }

    return files;
  }

  private get itemsToDisplay() {
    return this.areAllItemsDisplayed
      ? this.items
      : this.items.slice(0, MAX_ITEMS_TO_DISPLAY);
  }

  private get canDisplayAddButton() {
    if (!this.args.maxNumberOfItemsToAttach || !this.args.cardIdsToAttach) {
      return true;
    }
    return (
      this.args.cardIdsToAttach.length < this.args.maxNumberOfItemsToAttach
    );
  }

  @action
  private chooseCard() {
    this.chooseCardTask.perform();
  }

  private chooseCardTask = restartableTask(async () => {
    let cardId = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (cardId) {
      this.args.chooseCard(cardId);
    }
  });

  @action
  private async chooseFile() {
    let file = await this.doChooseFile.perform();
    if (file) {
      this.args.chooseFile(file);
    }
  }

  private doChooseFile = restartableTask(async () => {
    let chosenFile: FileDef | undefined = await chooseFile();
    return chosenFile;
  });
}
