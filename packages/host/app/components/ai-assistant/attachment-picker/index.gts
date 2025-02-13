import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { TrackedSet } from 'tracked-built-ins';

import { AddButton, Tooltip, Pill } from '@cardstack/boxel-ui/components';
import { and, cn, eq, gt, not } from '@cardstack/boxel-ui/helpers';

import {
  chooseCard,
  baseCardRef,
  isCardInstance,
  chooseFile,
} from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';
import ENV from '@cardstack/host/config/environment';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';

import { Submode } from '../../submode-switcher';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    autoAttachedCards?: TrackedSet<CardDef>;
    cardsToAttach: CardDef[] | undefined;
    autoAttachedFile?: FileDef;
    filesToAttach: FileDef[] | undefined;
    chooseCard: (card: CardDef) => void;
    removeCard: (card: CardDef) => void;
    chooseFile: (file: FileDef) => void;
    removeFile: (file: FileDef) => void;
    submode: Submode;
    maxNumberOfItemsToAttach?: number;
  };
}

const isAttachingFilesEnabled = ENV.featureFlags?.ENABLE_ATTACHING_FILES;
const MAX_ITEMS_TO_DISPLAY = 4;

export default class AiAssistantAttachmentPicker extends Component<Signature> {
  <template>
    <div class='item-picker'>
      {{#each this.itemsToDisplay as |item|}}
        {{#if (this.isCard item)}}
          {{#if (this.isAutoAttachedCard item)}}
            <Tooltip @placement='top'>
              <:trigger>
                <CardPill
                  @card={{item}}
                  @isAutoAttachedCard={{true}}
                  @removeCard={{@removeCard}}
                />
              </:trigger>

              <:content>
                {{#if (this.isAutoAttachedCard item)}}
                  Topmost card is shared automatically
                {{/if}}
              </:content>
            </Tooltip>
          {{else}}
            <CardPill
              @card={{item}}
              @isAutoAttachedCard={{false}}
              @removeCard={{@removeCard}}
            />
          {{/if}}
        {{else if isAttachingFilesEnabled}}
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
        {{#if (and (eq @submode 'code') isAttachingFilesEnabled)}}
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
            @disabled={{this.doChooseCard.isRunning}}
            data-test-choose-card-btn
          >
            <span class={{if this.cards.length 'boxel-sr-only'}}>
              Add Card
            </span>
          </AddButton>
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

  @tracked areAllItemsDisplayed = false;

  @action
  private toggleViewAllAttachedCards() {
    this.areAllItemsDisplayed = !this.areAllItemsDisplayed;
  }

  private isCard = (item: CardDef | FileDef): item is CardDef => {
    return isCardInstance(item);
  };

  private isAutoAttachedCard = (card: CardDef) => {
    return this.args.autoAttachedCards?.has(card);
  };

  private isAutoAttachedFile = (file: FileDef) => {
    return this.args.autoAttachedFile?.sourceUrl === file.sourceUrl;
  };

  private get items() {
    return [...this.cards, ...this.files];
  }

  private get cards() {
    let cards = this.args.cardsToAttach ?? [];

    if (this.args.autoAttachedCards) {
      cards = [...new Set([...this.args.autoAttachedCards, ...cards])];
    }

    cards = cards.filter((card) => card.id); // Dont show new unsaved cards
    return cards;
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
    if (!this.args.maxNumberOfItemsToAttach || !this.args.cardsToAttach) {
      return true;
    }
    return this.args.cardsToAttach.length < this.args.maxNumberOfItemsToAttach;
  }

  @action
  private async chooseCard() {
    let card = await this.doChooseCard.perform();
    if (card) {
      this.args.chooseCard(card);
    }
  }

  private doChooseCard = restartableTask(async () => {
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    return chosenCard;
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
