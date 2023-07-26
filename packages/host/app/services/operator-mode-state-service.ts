import {
  type OperatorModeState,
  type Stack,
  type StackItem,
} from '../components/operator-mode/container';
import Service from '@ember/service';
import type CardService from '../services/card-service';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { getOwner } from '@ember/application';
import { scheduleOnce } from '@ember/runloop';
import stringify from 'safe-stable-stringify';
import type { Card } from 'https://cardstack.com/base/card-api';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

interface CardItem {
  type: 'card';
  id: string;
  format: 'isolated' | 'edit';
}
interface ContainedCardItem {
  type: 'contained';
  fieldOfIndex: number; // index of the item in the stack that this is a field of
  fieldName: string;
  format: 'isolated' | 'edit';
}
type SerializedItem = CardItem | ContainedCardItem;
type SerializedStack = SerializedItem[];

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

  addItemToStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    if (!this.state.stacks[stackIndex]) {
      this.state.stacks[stackIndex] = new TrackedArray([]);
    }
    this.state.stacks[stackIndex].push(item);
    if (item.type === 'card') {
      this.addRecentCards(item.card);
    }
    this.schedulePersist();
  }

  trimItemsFromStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this.state.stacks[stackIndex].indexOf(item);
    this.state.stacks[stackIndex].splice(itemIndex); // Always remove anything above the item

    // If the resulting stack is now empty, remove it from the state
    if (
      this.state.stacks[stackIndex].length === 0 &&
      this.state.stacks.length > 1
    ) {
      this.state.stacks.splice(stackIndex, 1);
    }

    this.schedulePersist();
  }

  popItemFromStack(stackIndex: number) {
    let stack = this.state.stacks[stackIndex];
    if (!stack) {
      throw new Error(`No stack at index ${stackIndex}`);
    }
    let item = stack.pop();
    if (!item) {
      throw new Error(`No items in stack at index ${stackIndex}`);
    }
    this.schedulePersist();
    return item;
  }

  replaceItemInStack(item: StackItem, newItem: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this.state.stacks[stackIndex].indexOf(item);

    if (newItem.stackIndex !== stackIndex) {
      // this could be a smell that the stack index should not live in the item
      throw new Error(
        'cannot move stack item to different stack--this can destabilize contained card pointers'
      );
    }

    this.state.stacks[stackIndex].splice(itemIndex, 1, newItem);
    this.schedulePersist();
  }

  shiftStack(stack: StackItem[], destinationIndex: number) {
    stack.forEach((item) => {
      this.trimItemsFromStack(item);
      this.addItemToStack({ ...item, stackIndex: destinationIndex });
    });
    return this.schedulePersist();
  }

  clearStacks() {
    this.state.stacks.splice(0);
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
      let serializedStack: SerializedStack = [];
      for (let item of stack) {
        if (item.format !== 'isolated' && item.format !== 'edit') {
          throw new Error(`Unknown format for card on stack ${item.format}`);
        }
        if (item.type === 'card') {
          if (item.card.id) {
            serializedStack.push({
              type: 'card',
              id: item.card.id,
              format: item.format,
            });
          }
        } else {
          let { fieldName, fieldOfIndex } = item;
          serializedStack.push({
            type: 'contained',
            fieldName,
            fieldOfIndex,
            format: item.format,
          });
        }
      }
      state.stacks.push(serializedStack);
    }

    return state;
  }

  // Stringified JSON version of state, with only cards that have been saved, used for the query param
  serialize(): string {
    return stringify(this.rawStateWithSavedCardsOnly())!;
  }

  // Deserialize a stringified JSON version of OperatorModeState into a Glimmer tracked object
  // so that templates can react to changes in stacks and their items
  async deserialize(rawState: SerializedState): Promise<OperatorModeState> {
    let newState: OperatorModeState = new TrackedObject({
      stacks: [],
    });

    let stackIndex = 0;
    for (let stack of rawState.stacks) {
      let newStack: Stack = new TrackedArray([]);
      for (let item of stack) {
        let { format } = item;
        if (item.type === 'card') {
          let card = await this.cardService.loadModel(new URL(item.id));
          newStack.push({
            type: 'card',
            card,
            format,
            stackIndex,
          });
        } else {
          let { fieldName, fieldOfIndex } = item;
          newStack.push({
            type: 'contained',
            fieldName,
            fieldOfIndex,
            format,
            stackIndex,
          });
        }
      }
      newState.stacks.push(newStack);
      stackIndex++;
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

  addRecentCards(card: Card) {
    const existingCardIndex = this.recentCards.findIndex(
      (recentCard) => recentCard.id === card.id
    );
    if (existingCardIndex !== -1) {
      this.recentCards.splice(existingCardIndex, 1);
    }

    this.recentCards.push(card);
    if (this.recentCards.length > 10) {
      this.recentCards.splice(0, 1);
    }
    const recentCardIds = this.recentCards
      .map((recentCard) => recentCard.id)
      .filter(Boolean); // don't include cards that don't have an ID
    localStorage.setItem('recent-cards', JSON.stringify(recentCardIds));
  }
}
