import { action } from '@ember/object';

import { Resource } from 'ember-resources';

import { TrackedSet } from 'tracked-built-ins';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    stackItems: StackItem[];
    attachedCards: CardDef[] | undefined; // cards manually attached in ai panel
  };
}

/**
 * Manages the auto-attachment of cards within our stack in consideration of user-actions of manually
 * removing and attaching new cards in the ai panel
 */
export class AutoAttachment extends Resource<Args> {
  cards: TrackedSet<CardDef> = new TrackedSet(); // auto-attached cards
  private lastStackedItems: StackItem[] = [];
  private lastRemovedCards: Set<string> = new Set(); // internal state, changed from the outside. It tracks, everytime a card is removed in the ai-panel

  modify(_positional: never[], named: Args['named']) {
    const { stackItems, attachedCards } = named;
    if (this.stackItemsChanged(stackItems)) {
      // we must be sure to clear the lastRemovedCards state so cards can be auto-attached again
      // note: if two of the same cards are opened on separate stack, one will be auto-attached.
      // If one is removed from one of the stacks, the card WILL be auto-attached.
      this.lastRemovedCards.clear();
    }
    this.cards.clear();
    stackItems.forEach((item) => {
      if (item === undefined) {
        // TODO: another place where stackItems = [undefined]. Pls remove after finding root cause
        return;
      }
      if (!this.hasRealmURL(item) || this.isIndexCard(item)) {
        return;
      }
      if (
        this.isAlreadyAttached(item.card, attachedCards) ||
        this.wasPreviouslyRemoved(item.card)
      ) {
        return;
      }
      this.cards.add(item.card);
    });
    this.lastStackedItems = stackItems;
  }

  stackItemsChanged(stackItems: StackItem[]) {
    if (stackItems.length !== this.lastStackedItems.length) {
      return true;
    }
    for (let i = 0; i < stackItems.length; i++) {
      if (stackItems[i].card.id !== this.lastStackedItems[i].card.id) {
        return true;
      }
    }
    return false;
  }

  private hasRealmURL(stackItem: StackItem) {
    // if (!('card' in stackItem )) {
    //   return false;
    // }
    let realmURL = stackItem.card[stackItem.api.realmURL];
    if (!realmURL) {
      return false;
    }
    return true;
  }

  private isIndexCard(stackItem: StackItem) {
    let realmURL = stackItem.card[stackItem.api.realmURL];
    if (stackItem.card.id === `${realmURL!.href}index`) {
      return true;
    }
    return false;
  }

  private isAlreadyAttached(
    lastTopMostCard: CardDef,
    attachedCards: CardDef[] | undefined,
  ) {
    if (attachedCards === undefined) {
      return false;
    }
    return attachedCards?.some((c) => c.id === lastTopMostCard.id);
  }

  private wasPreviouslyRemoved(lastTopMostCard: CardDef) {
    return this.lastRemovedCards.has(lastTopMostCard.id);
  }

  @action
  onCardRemoval(card: CardDef) {
    this.lastRemovedCards.add(card.id);
  }
}

export function getAutoAttachment(
  parent: object,
  stackItems: () => StackItem[],
  attachedCards: () => CardDef[] | undefined,
) {
  return AutoAttachment.from(parent, () => ({
    named: {
      stackItems: stackItems(),
      attachedCards: attachedCards(),
    },
  }));
}
