import {
  OperatorModeState,
  StackItem,
} from '@cardstack/host/components/operator-mode';
import Service from '@ember/service';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

export default class OperatorModeStateService extends Service {
  // @ts-ignore Property 'state' has no initializer and is not definitely assigned in the constructor.
  // ts complains that state is not initialized, but it fails to understand
  // that this.restore() sets it
  state: OperatorModeState;

  constructor(owner: object) {
    super(owner);

    this.restore();
  }

  restore() {
    // TODO: Implement restoration from query param in the URL

    this.state = new TrackedObject({
      stacks: [
        {
          items: new TrackedArray([]),
        },
      ],
    });
  }

  addItemToStack(item: StackItem, stackIndex = 0) {
    this.state.stacks[stackIndex].items.push(item);
    this.persist();
  }

  removeItemFromStack(item: StackItem, stackIndex = 0) {
    let itemIndex = this.state.stacks[stackIndex].items.indexOf(item);
    this.state.stacks[stackIndex].items.splice(itemIndex);
    this.persist();
  }

  replaceItemInStack(item: StackItem, newItem: StackItem, stackIndex = 0) {
    let itemIndex = this.state.stacks[stackIndex].items.indexOf(item);
    this.state.stacks[stackIndex].items.splice(itemIndex, 1, newItem);
    this.persist();
  }

  clearStack(stackIndex = 0) {
    this.state.stacks[stackIndex].items.splice(0);
    this.persist();
  }

  persist() {
    // TODO: Implement persisting state to query param in the URL
  }
}
