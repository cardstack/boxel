import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { AddButton, IconButton, Tooltip } from '@cardstack/boxel-ui/components';
import { and, cn, eq, gt, not } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import RealmIcon from '../../operator-mode/realm-icon';
import Pill from '../../pill';

interface CardPillSignature {
  Element: HTMLDivElement;
  Args: {
    card: CardDef;
    index: number;
    isAutoAttachedCard?: boolean;
    removeCard: (card: CardDef) => void;
  };
}

class CardPill extends Component<CardPillSignature> {
  <template>
    <Pill
      @inert={{true}}
      class={{cn 'card-pill' is-autoattached=@isAutoAttachedCard}}
      data-test-pill-index={{@index}}
      data-test-selected-card={{@card.id}}
    >
      <:icon>
        <RealmInfoProvider @fileURL={{@card.id}}>
          <:ready as |realmInfo|>
            <RealmIcon
              @realmIconURL={{realmInfo.iconURL}}
              @realmName={{realmInfo.name}}
              width='18'
              height='18'
            />
          </:ready>
        </RealmInfoProvider>
      </:icon>
      <:default>
        <div class='card-title'>
          {{if @card.title @card.title 'Untitled Card'}}
        </div>
        <IconButton
          class='remove-button'
          @icon={{IconX}}
          {{on 'click' (fn @removeCard @card)}}
          data-test-remove-card-btn={{@index}}
        />
      </:default>
    </Pill>
    <style>
      .remove-button {
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
      .card-pill {
        --pill-icon-size: 18px;
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        height: 1.875rem;
      }
      .card-title {
        max-width: 10rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .is-autoattached {
        border-style: dashed;
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    autoAttachedCard?: CardDef;
    cardsToAttach: CardDef[] | undefined;
    chooseCard: (card: CardDef) => void;
    removeCard: (card: CardDef) => void;
    maxNumberOfCards?: number;
  };
}

const MAX_CARDS_TO_DISPLAY = 4;
export default class AiAssistantCardPicker extends Component<Signature> {
  <template>
    <div class='card-picker'>
      {{#each this.cardsToDisplay as |card i|}}
        {{#if (this.isCardDisplayed card i)}}
          {{#if (this.isAutoAttachedCard card)}}
            <Tooltip @placement='top'>
              <:trigger>
                <CardPill
                  @card={{card}}
                  @index={{i}}
                  @isAutoAttachedCard={{true}}
                  @removeCard={{@removeCard}}
                />
              </:trigger>

              <:content>
                {{#if (eq card.id @autoAttachedCard.id)}}
                  Topmost card is shared automatically
                {{/if}}
              </:content>
            </Tooltip>
          {{else}}
            <CardPill
              @card={{card}}
              @index={{i}}
              @isAutoAttachedCard={{false}}
              @removeCard={{@removeCard}}
            />
          {{/if}}
        {{/if}}
      {{/each}}
      {{#if
        (and
          (gt this.cardsToDisplay.length MAX_CARDS_TO_DISPLAY)
          (not this.isViewAllAttachedCards)
        )
      }}
        <Pill
          @inert={{true}}
          class='card-pill view-all'
          data-test-view-all
          {{on 'click' this.toggleViewAllAttachedCards}}
        >
          <:default>
            <div class='card-title'>
              View All ({{this.cardsToDisplay.length}})
            </div>
          </:default>
        </Pill>
      {{/if}}
      {{#if this.canDisplayAddButton}}
        <AddButton
          class='attach-button'
          @variant='pill'
          {{on 'click' this.chooseCard}}
          @disabled={{this.doChooseCard.isRunning}}
          data-test-choose-card-btn
        >
          Attach Card
        </AddButton>
      {{/if}}
    </div>
    <style>
      .card-picker {
        --pill-height: 1.875rem;
        --pill-content-max-width: 10rem;
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp);
      }
      .attach-button {
        --boxel-form-control-border-radius: var(--boxel-border-radius-sm);
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        height: var(--pill-height);
        padding: 0 var(--boxel-sp-xs);
      }
      .attach-button:hover:not(:disabled) {
        box-shadow: none;
        background-color: var(--boxel-highlight-hover);
      }
      .view-all {
        cursor: pointer;
      }
    </style>
  </template>

  @tracked isViewAllAttachedCards = false;

  @action
  private toggleViewAllAttachedCards() {
    this.isViewAllAttachedCards = !this.isViewAllAttachedCards;
  }

  @action
  private isCardDisplayed(card: CardDef, index: number): boolean {
    if (
      this.isViewAllAttachedCards ||
      this.cardsToDisplay.length <= MAX_CARDS_TO_DISPLAY
    ) {
      return !!card.id;
    } else {
      // If attached cards more than four,
      // displays the first three cards.
      return !!card.id && index < MAX_CARDS_TO_DISPLAY - 1;
    }
  }

  private get cardsToDisplay() {
    let cards = this.args.cardsToAttach ?? [];
    if (this.args.autoAttachedCard) {
      cards = [...new Set([this.args.autoAttachedCard, ...cards])];
    }
    return cards;
  }

  private get canDisplayAddButton() {
    if (!this.args.maxNumberOfCards || !this.args.cardsToAttach) {
      return true;
    }
    return this.args.cardsToAttach.length < this.args.maxNumberOfCards;
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
  private isAutoAttachedCard(card: CardDef) {
    return this.args.autoAttachedCard?.id === card.id;
  }
}
