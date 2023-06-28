import {
  OperatorModeState,
  Stack,
  StackItem,
} from '@cardstack/host/components/operator-mode/container';
import Service from '@ember/service';
import type CardService from '../services/card-service';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';
import { getOwner } from '@ember/application';
import { scheduleOnce } from '@ember/runloop';
import { Card } from 'https://cardstack.com/base/card-api';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

type SerializedItem = { card: { id: string }; format: 'isolated' | 'edit' };
type SerializedStack = { items: SerializedItem[] };
export type SerializedState = { stacks: SerializedStack[] };

export default class OperatorModeStateService extends Service {
  @tracked state: OperatorModeState = new TrackedObject({
    stacks: new TrackedArray([]),
  });
  @tracked recentCards = new TrackedArray<Card>([]);

  @service declare cardService: CardService;

  async restore(rawState: SerializedState) {
    this.state = await this.deserialize(rawState);
  }

  addItemToStack(item: StackItem, stackIndex = 0) {
    this.state.stacks[stackIndex].items.push(item);
    this.addRecentCards(item.card);
    this.schedulePersist();
  }

  removeItemFromStack(item: StackItem, stackIndex = 0) {
    let itemIndex = this.state.stacks[stackIndex].items.indexOf(item);
    this.state.stacks[stackIndex].items.splice(itemIndex);
    this.schedulePersist();
  }

  replaceItemInStack(item: StackItem, newItem: StackItem, stackIndex = 0) {
    let itemIndex = this.state.stacks[stackIndex].items.indexOf(item);
    this.state.stacks[stackIndex].items.splice(itemIndex, 1, newItem);
    this.schedulePersist();
  }

  clearStack(stackIndex = 0) {
    this.state.stacks[stackIndex].items.splice(0);
    this.schedulePersist();
  }

  private schedulePersist() {
    // When multiple stack manipulations are bunched together in a loop, for example when closing multiple cards in a loop,
    // we get into a async race condition where the change to cardController.operatorModeState will reload the route and
    // restore the state from the query param in a way that is out of sync with the state in the service. To avoid this,
    // we do the change to the query param only after all modifications to the state have been rendered.
    scheduleOnce('afterRender', this, this.persist);
  }

  private persist() {
    let cardController = getOwner(this)!.lookup('controller:card') as any;
    if (!cardController) {
      throw new Error(
        'OperatorModeStateService must be used in the context of a CardController'
      );
    }

    // Setting this property will trigger a query param update on the controller, which will reload the route
    cardController.operatorModeState = this.serialize();
  }

  // Serialized POJO version of state, with only cards that have been saved.
  // The state can have cards that have not been saved yet, for example when
  // clicking on "Crate New" in linked card editor. Here we want to draw a boundary
  // between navigatable states in the query parameter
  rawStateWithSavedCardsOnly() {
    let state: SerializedState = { stacks: [] };

    for (let stack of this.state.stacks) {
      let _stack: SerializedStack = { items: [] };

      for (let item of stack.items) {
        let cardId = item.card.id;
        let card = { id: cardId };

        if (cardId) {
          if (item.format === 'isolated' || item.format === 'edit') {
            _stack.items.push({ card, format: item.format });
          } else {
            throw new Error(`Unknown format for card on stack ${item.format}`);
          }
        }
      }

      state.stacks.push(_stack);
    }

    return state;
  }

  // Stringified JSON version of state, with only cards that have been saved, used for the query param
  serialize(): string {
    return JSON.stringify(this.rawStateWithSavedCardsOnly());
  }

  // Deserialize a stringified JSON version of OperatorModeState into a Glimmer tracked object
  // so that templates can react to changes in stacks and their items
  async deserialize(rawState: SerializedState): Promise<OperatorModeState> {
    let newState: OperatorModeState = new TrackedObject({
      stacks: [],
    });

    for (let stack of rawState.stacks) {
      let newStack: Stack = { items: new TrackedArray([]) };
      for (let item of stack.items) {
        let cardUrl = new URL(item.card.id);
        let card = await this.cardService.loadModel(cardUrl);
        newStack.items.push({ card, format: item.format });
      }
      newState.stacks.push(newStack);
    }

    return newState;
  }

  async constructRecentCards() {
    const recentCardIdsString = localStorage.getItem('recent-cards');
    if (!recentCardIdsString) {
      return;
    }

    const recentCardIds = JSON.parse(recentCardIdsString) as string[];
    for (const recentCardId of recentCardIds) {
      const card = await this.cardService.loadModel(new URL(recentCardId));
      this.recentCards.push(card);
    }
  }

  async addRecentCards(card: Card) {
    const existingCardIndex = this.recentCards.findIndex(
      (recentCard) => recentCard.id === card.id
    );
    if (existingCardIndex !== -1) {
      this.recentCards.splice(existingCardIndex, 1);
    }

    this.recentCards.push(card);
    if (this.recentCards.length > 10) {
      this.recentCards = new TrackedArray<Card>(this.recentCards.slice(1));
    }
    const recentCardIds = this.recentCards.map((recentCard) => recentCard.id);
    localStorage.setItem('recent-cards', JSON.stringify(recentCardIds));
  }
}
