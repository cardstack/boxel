import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

import RealmIcon from '../../operator-mode/realm-icon';
import Pill from '../../pill';

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
        {{#if card.id}}
          <Pill
            @inert={{true}}
            class={{cn
              'card-pill'
              is-autoattached=(eq card.id @autoAttachedCard.id)
            }}
            data-test-pill-index={{i}}
            data-test-selected-card={{card.id}}
          >
            <:icon>
              <RealmInfoProvider @fileURL={{card.id}}>
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
                {{if card.title card.title 'Untitled Card'}}
              </div>
              <IconButton
                class='remove-button'
                @icon={{IconX}}
                {{on 'click' (fn @removeCard card)}}
                data-test-remove-card-btn={{i}}
              />
            </:default>
          </Pill>
        {{/if}}
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
