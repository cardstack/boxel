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

// Focus moves once the render is done. Focusing an element fires blur and
// focusout on the one that had focus, and a handler there may change state
// the render has already read.

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
  if (keepsFocus(active)) {
    return;
  }
  schedule('afterRender', () => {
    if (element.isConnected && isTopCard()) {
      element.focus({ preventScroll: true });
    }
  });
}

interface Leaving {
  item: StackItem;
  // The stack the item is in.
  stack: StackItem[];
  // The state's stacks as the item rendered.
  stacks: StackItem[][];
}

// The items that left the page in the current render while focus was lost,
// waiting for focus to be handed back.
let leftWithFocusLost: Leaving[] = [];

// As a stack item leaves the page, focus that went with it is handed back,
// once for everything that left in the same render.
function leaveStackItem(
  leaving: Leaving,
  operatorModeStateService: OperatorModeStateService,
) {
  if (focusedElement()) {
    return;
  }
  leftWithFocusLost.push(leaving);
  if (leftWithFocusLost.length === 1) {
    schedule('afterRender', () => handBackFocus(operatorModeStateService));
  }
}

// A card that closed hands focus to what opened it, when that is still on the
// page and not covered by another card. Otherwise focus goes to the card on
// top of a stack an item left, or to the top card Escape acts on when those
// stacks have gone. Focus the user has put elsewhere, or that a card opening
// in the same render has taken, stays where it is.
function handBackFocus(operatorModeStateService: OperatorModeStateService) {
  let left = leftWithFocusLost;
  leftWithFocusLost = [];
  if (focusedElement()) {
    return;
  }
  let stacks = operatorModeStateService.state?.stacks ?? [];
  for (let { item, stacks: renderedIn } of left) {
    // A clone that continues the card (moving stacks, or taking its saved id)
    // shares its opening; the card hasn't closed. Nor has a card whose stacks
    // were replaced as a whole, as restoring them from the URL does: every
    // item is rebuilt, and the stacks restored have their own card on top.
    let closed =
      renderedIn === stacks &&
      !stacks.some((items) =>
        items.some((other) => other.opening === item.opening),
      );
    if (closed && focusIfConnected(item.opening.opener?.deref())) {
      return;
    }
  }
  let stack = left
    .map(({ stack }) => stack)
    .find((stack) => stacks.includes(stack) && stack.length > 0);
  let target = stack
    ? stack[stack.length - 1]
    : escapeTarget(operatorModeStateService.topMostStackItems());
  if (target) {
    focusIfConnected(
      document.querySelector(`[data-stack-item="${target.instanceId}"]`),
    );
  }
}

// Applied to a stack item's root. The item opens as the modifier first runs,
// and leaves as the modifier is destroyed with the item's element. A rerun,
// as the arguments it read change, is neither.
export default class FollowFocus extends Modifier<Signature> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  #leaving: Leaving | undefined;

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.#leaving) {
        leaveStackItem(this.#leaving, this.operatorModeStateService);
      }
    });
  }

  modify(
    element: HTMLElement,
    _positional: [],
    { item, stack, isTopCard }: NamedArgs<Signature>,
  ) {
    this.#leaving ??= {
      item,
      stack,
      stacks: this.operatorModeStateService.state.stacks,
    };
    openStackItem(element, item, isTopCard);
  }
}
