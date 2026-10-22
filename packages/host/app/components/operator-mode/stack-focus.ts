import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type { StackItem } from '@cardstack/host/lib/stack-item';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import {
  focusIfConnected,
  focusedElement,
} from '@cardstack/host/utils/stack-item-focus';

import type { ArgsFor, NamedArgs } from 'ember-modifier';

// Focus in the operator-mode stacks follows the cards the way it follows a
// non-modal dialog. A card takes focus as it opens, so the keyboard and a
// screen reader carry on in the card now on top, and hands focus back to
// what opened it as it closes. Each stack item does this for itself, as it
// first renders and as it leaves the page.

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [];
    Named: {
      item: StackItem;
      // The stack the item is in.
      stack: StackItem[];
      isTopCard: () => boolean;
    };
  };
}

// Whether focus stays where it is as a card opens. A text entry keeps it, so
// a card opened on the user's behalf (by the AI assistant, say) doesn't take
// keystrokes meant for a field. A panel that holds focus, like the AI
// assistant's, keeps it too while the cards it opens appear in the stacks.
function keepsFocus(active: Element | null): boolean {
  return Boolean(
    active?.matches(':read-write') || active?.closest('[data-holds-focus]'),
  );
}

// The top card Escape acts on: the one the user most recently interacted
// with.
function escapeTarget(topItems: StackItem[]): StackItem | undefined {
  return topItems.length > 0
    ? topItems.reduce((a, b) =>
        b.lastInteractedAt > a.lastInteractedAt ? b : a,
      )
    : undefined;
}

// As a stack item first renders, a card that is opening records what had
// focus, and takes focus itself when it opens on top of its stack.
function openStackItem(
  element: HTMLElement,
  item: StackItem,
  isTopCard: () => boolean,
) {
  let { opening } = item;
  if (opening.opened) {
    return;
  }
  opening.opened = true;
  let active = focusedElement();
  opening.opener = active ? new WeakRef(active) : undefined;
  if (isTopCard() && !keepsFocus(active)) {
    element.focus({ preventScroll: true });
  }
}

// As a stack item leaves the page, focus that went with it is handed back.
// A card that closed hands it to what opened the card, when that is still on
// the page and not covered by another card. Otherwise, once the stacks have
// rendered, it goes to the card on top of the item's stack, or to the top
// card Escape acts on when that stack has gone. Focus the user has put
// elsewhere stays where it is.
function leaveStackItem(
  item: StackItem,
  stack: StackItem[],
  operatorModeStateService: OperatorModeStateService,
) {
  if (focusedElement()) {
    return;
  }
  let stacks = operatorModeStateService.state?.stacks ?? [];
  // A clone that continues the card (moving stacks, or taking its saved id)
  // shares its opening; the card hasn't closed.
  let closed = !stacks.some((items) =>
    items.some((other) => other.opening === item.opening),
  );
  if (closed && focusIfConnected(item.opening.opener?.deref())) {
    return;
  }
  // Scheduled, so that every item leaving in the same render gets to hand
  // focus to its opener first.
  schedule('afterRender', () => {
    if (focusedElement()) {
      return;
    }
    let stacks = operatorModeStateService.state?.stacks ?? [];
    let target =
      stacks.includes(stack) && stack.length > 0
        ? stack[stack.length - 1]
        : escapeTarget(operatorModeStateService.topMostStackItems());
    if (target) {
      focusIfConnected(
        document.querySelector(`[data-stack-item="${target.instanceId}"]`),
      );
    }
  });
}

// Applied to a stack item's root. The item opens as the modifier first runs,
// and leaves as the modifier is destroyed with the item's element. A rerun,
// as the arguments it read change, is neither.
export default class FollowFocus extends Modifier<Signature> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  #item: StackItem | undefined;
  #stack: StackItem[] = [];

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.#item) {
        leaveStackItem(this.#item, this.#stack, this.operatorModeStateService);
      }
    });
  }

  modify(
    element: HTMLElement,
    _positional: [],
    { item, stack, isTopCard }: NamedArgs<Signature>,
  ) {
    this.#item = item;
    this.#stack = stack;
    openStackItem(element, item, isTopCard);
  }
}
