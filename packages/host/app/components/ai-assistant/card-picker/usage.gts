import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedArray } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import AiAssistantCardPicker from './index';

export default class AiAssistantCardPickerUsage extends Component {
  cards: TrackedArray<CardDef> = new TrackedArray([]);
  @tracked maxNumberOfCards: number | undefined = undefined;
  @tracked autoAttachedCard: CardDef | undefined = undefined;

  @action chooseCard(card: CardDef) {
    if (!this.cards?.find((c) => c.id === card.id)) {
      this.cards.push(card);
    }
  }

  @action removeCard(card: CardDef) {
    let index = this.cards.findIndex((c) => c.id === card.id);
    this.cards.splice(index, 1);
  }

  <template>
    <FreestyleUsage @name='AiAssistant::CardPicker'>
      <:description>
        Card picker for AI Assistant chat input. It allows to pick a card from
        the card catalog. Selected card is attached to the message in atom
        format.
      </:description>
      <:example>
        <AiAssistantCardPicker
          @autoAttachedCard={{this.autoAttachedCard}}
          @cardsToAttach={{this.cards}}
          @chooseCard={{this.chooseCard}}
          @removeCard={{this.removeCard}}
          @maxNumberOfCards={{this.maxNumberOfCards}}
        />
        <CardCatalogModal />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='cardsToAttach'
          @description='An array of cards to attach to the message.'
          @value={{this.cards}}
        />
        <Args.Object
          @name='autoAttachedCard'
          @description='A card automatically attached to the message from the top of the stack.'
          @value={{this.autoAttachedCard}}
        />
        <Args.Action
          @name='chooseCard'
          @description='Action to be taken when a card is chosen'
          @value={{this.chooseCard}}
        />
        <Args.Action
          @name='removeCard'
          @description='Action to be taken when a card is removed'
          @value={{this.removeCard}}
        />
        <Args.Number
          @name='maxNumberOfCards'
          @description='Maximum number of cards that can be added. If a value is not provided, there is no limit.'
          @onInput={{fn (mut this.maxNumberOfCards)}}
          @value={{this.maxNumberOfCards}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
