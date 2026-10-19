import { modifier } from 'ember-modifier';

import type { StackItem } from '@cardstack/host/lib/stack-item';

interface Placed {
  item: StackItem;
  stackIndex: number;
  itemIndex: number;
}

function place(stacks: StackItem[][]): Placed[] {
  return stacks.flatMap((stack, stackIndex) =>
    stack.map((item, itemIndex) => ({ item, stackIndex, itemIndex })),
  );
}

function focusedElement(): Element | null {
  let active = document.activeElement;
  return active && active !== document.body ? active : null;
}

function focusIfConnected(element: Element | null | undefined): boolean {
  if (element instanceof HTMLElement && element.isConnected) {
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  }
  return false;
}

// Keeps keyboard focus with the operator-mode stacks as cards open and close.
// A card that opens takes focus, so the keyboard and a screen reader carry on
// in the card that is now on top. A card that closes gives focus back to what
// opened it. Focus is tracked per stack item rather than per stack, since a
// card can open into the neighboring stack and a stack goes away with its
// last card.
export default class StackFocus {
  // What had focus as each item opened.
  private openers = new WeakMap<StackItem, Element | null>();
  private previous: StackItem[][] | undefined;

  // Applied to the element whose children are the stacks, in order, with a
  // snapshot of every stack's items.
  follow = modifier((element: HTMLElement, [stacks]: [StackItem[][]]) => {
    let previous = this.previous;
    this.previous = stacks.map((stack) => [...stack]);
    // The stacks present as interact mode renders were restored, not opened.
    if (!previous) {
      return;
    }

    let before = place(previous);
    let after = place(stacks);
    let beforeItems = new Set(before.map(({ item }) => item));
    let afterItems = new Set(after.map(({ item }) => item));
    let arrived = after.filter(({ item }) => !beforeItems.has(item));
    let left = before.filter(({ item }) => !afterItems.has(item));

    if (arrived.length > 0) {
      this.arrive(element, stacks, arrived, left);
    } else if (left.length > 0) {
      this.leave(element, stacks, previous, left[0]);
    }
  });

  private arrive(
    element: HTMLElement,
    stacks: StackItem[][],
    arrived: Placed[],
    left: Placed[],
  ) {
    let active = focusedElement();
    let opened: Placed[] = [];
    for (let placed of arrived) {
      // A stack that shifts sideways is rebuilt from copies of its items: the
      // copies are the same cards moving, not cards opening.
      let moved = left.find(
        ({ item, stackIndex }) =>
          item.id === placed.item.id && stackIndex !== placed.stackIndex,
      );
      let replaced =
        moved ??
        left.find(
          ({ stackIndex, itemIndex }) =>
            stackIndex === placed.stackIndex && itemIndex === placed.itemIndex,
        );
      this.openers.set(
        placed.item,
        replaced && this.openers.has(replaced.item)
          ? (this.openers.get(replaced.item) ?? null)
          : active,
      );
      if (!moved) {
        opened.push(placed);
      }
    }

    // A panel that holds focus, like the AI assistant's, keeps it while the
    // cards it opens appear in the stacks.
    if (opened.length === 0 || active?.closest('[data-holds-focus]')) {
      return;
    }
    let target =
      [...opened]
        .reverse()
        .find(
          ({ stackIndex, itemIndex }) =>
            itemIndex === stacks[stackIndex].length - 1,
        ) ?? opened[opened.length - 1];
    this.focusItem(element, target.stackIndex, target.itemIndex);
  }

  private leave(
    element: HTMLElement,
    stacks: StackItem[][],
    previous: StackItem[][],
    lowestClosed: Placed,
  ) {
    // Focus the user has put somewhere that is still on the page stays there;
    // only focus lost with the closed card is handed back.
    if (focusedElement()) {
      return;
    }
    if (focusIfConnected(this.openers.get(lowestClosed.item))) {
      return;
    }
    let { stackIndex, itemIndex } = lowestClosed;
    if (itemIndex > 0) {
      let uncovered = previous[stackIndex][itemIndex - 1];
      let at = place(stacks).find(({ item }) => item === uncovered);
      if (at) {
        this.focusItem(element, at.stackIndex, at.itemIndex);
      }
      return;
    }
    // The closed card was the last in its stack, and the stack went with it.
    let neighbor = Math.min(stackIndex, stacks.length - 1);
    if (neighbor >= 0 && stacks[neighbor].length > 0) {
      this.focusItem(element, neighbor, stacks[neighbor].length - 1);
    }
  }

  private focusItem(
    element: HTMLElement,
    stackIndex: number,
    itemIndex: number,
  ) {
    let item =
      element.children[stackIndex]?.querySelectorAll<HTMLElement>(
        '[data-stack-item]',
      )[itemIndex];
    if (item) {
      // focusable by script only, so it never becomes a Tab stop
      item.tabIndex = -1;
      item.focus({ preventScroll: true });
    }
  }
}
