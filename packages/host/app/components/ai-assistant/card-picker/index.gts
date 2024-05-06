import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';
import { and, cn, gt, not } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import Pill from '@cardstack/host/components/pill';

import { type CardDef } from 'https://cardstack.com/base/card-api';

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
                  @isAutoAttachedCard={{true}}
                  @removeCard={{@removeCard}}
                />
              </:trigger>

              <:content>
                {{#if (this.isAutoAttachedCard card)}}
                  Topmost card is shared automatically
                {{/if}}
              </:content>
            </Tooltip>
          {{else}}
            <CardPill
              @card={{card}}
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
        <Pill {{on 'click' this.toggleViewAllAttachedCards}} data-test-view-all>
          View All ({{this.cardsToDisplay.length}})
        </Pill>
      {{/if}}
      {{#if this.canDisplayAddButton}}
        <AddButton
          class={{cn 'attach-button' icon-only=this.cardsToDisplay.length}}
          @variant='pill'
          {{on 'click' this.chooseCard}}
          @disabled={{this.doChooseCard.isRunning}}
          data-test-choose-card-btn
        >
          <span class={{if this.cardsToDisplay.length 'boxel-sr-only'}}>
            Add a Card
          </span>
        </AddButton>
      {{/if}}
    </div>
    <style>
      .card-picker {
        --pill-height: 1.875rem;
        --pill-content-max-width: 10rem;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-xxs);
      }
      .attach-button {
        --icon-color: var(--boxel-highlight);
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        height: var(--pill-height);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xxxs) var(--boxel-sp-4xs)
          var(--boxel-sp-5xs);
        background: none;
        color: var(--boxel-highlight);
        transition: color var(--boxel-transition);
        outline: 0;
      }
      .attach-button :deep(svg) {
        padding: var(--boxel-sp-5xs);
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-highlight-hover);
        color: var(--boxel-highlight-hover);
        background: none;
        box-shadow: none;
      }
      .attach-button.icon-only {
        width: 30px;
        height: var(--pill-height);
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
