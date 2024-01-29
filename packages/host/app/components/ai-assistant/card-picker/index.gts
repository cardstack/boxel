import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import CardPill from '../card-pill';

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

export default class AiAssistantCardPicker extends Component<Signature> {
  <template>
    <div class='card-picker'>
      {{#each this.cardsToDisplay as |card i|}}
        <CardPill
          @card={{card}}
          class={{if (eq card.id @autoAttachedCard.id) 'is-autoattached'}}
          data-test-pill-index={{i}}
          data-test-selected-card={{card.id}}
        >
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            {{on 'click' (fn @removeCard card)}}
            data-test-remove-card-btn={{i}}
          />
        </CardPill>
      {{/each}}
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
      .is-autoattached {
        border-style: dashed;
      }
    </style>
  </template>

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
}
