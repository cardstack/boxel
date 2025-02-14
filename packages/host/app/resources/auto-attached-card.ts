import { action } from '@ember/object';

import { service } from '@ember/service';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedSet } from 'tracked-built-ins';

import type { StackItem } from '@cardstack/host/lib/stack-item';
import { isIndexCard } from '@cardstack/host/lib/stack-item';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { Submodes } from '../components/submode-switcher';
import OperatorModeStateService from '../services/operator-mode-state-service';
interface Args {
  named: {
    topMostStackItems: StackItem[];
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
  @service private declare operatorModeStateService: OperatorModeStateService;

  modify(_positional: never[], named: Args['named']) {
    const { topMostStackItems, attachedCards } = named;
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      return; // Don't auto-attach cards in code mode
    }
    this.updateAutoAttachedCardsTask.perform(topMostStackItems, attachedCards);
  }

  private updateAutoAttachedCardsTask = restartableTask(
    async (
      topMostStackItems: StackItem[],
      attachedCards: CardDef[] | undefined,
    ) => {
      await Promise.all(topMostStackItems.map((item) => item.ready()));
      if (this.stackItemsChanged(topMostStackItems)) {
        // we must be sure to clear the lastRemovedCards state so cards can be auto-attached again
        // note: if two of the same cards are opened on separate stack, one will be auto-attached.
        // If one is removed from one of the stacks, the card WILL be auto-attached.
        this.lastRemovedCards.clear();
      }
      this.cards.clear();
      topMostStackItems.forEach((item) => {
        if (!this.hasRealmURL(item) || isIndexCard(item)) {
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
      this.lastStackedItems = topMostStackItems;
    },
  );

  stackItemsChanged(topMostStackItems: StackItem[]) {
    if (topMostStackItems.length !== this.lastStackedItems.length) {
      return true;
    }
    for (let i = 0; i < topMostStackItems.length; i++) {
      if (topMostStackItems[i].card.id !== this.lastStackedItems[i].card.id) {
        return true;
      }
    }
    return false;
  }

  private hasRealmURL(stackItem: StackItem) {
    let realmURL = stackItem.card[stackItem.api.realmURL];
    return Boolean(realmURL);
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
  topMostStackItems: () => StackItem[],
  attachedCards: () => CardDef[] | undefined,
) {
  return AutoAttachment.from(parent, () => ({
    named: {
      topMostStackItems: topMostStackItems(),
      attachedCards: attachedCards(),
    },
  }));
}
