import { service } from '@ember/service';

import { Resource } from 'ember-resources';

import { TrackedSet } from 'tracked-built-ins';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import { Submodes } from '../components/submode-switcher';

import OperatorModeStateService from '../services/operator-mode-state-service';

interface Args {
  named: {
    topMostStackItems: StackItem[];
    attachedCardIds: string[] | undefined; // cards manually attached in ai panel
    removedCardIds: string[] | undefined;
  };
}

/**
 * Manages the auto-attachment of cards within our stack in consideration of user-actions of manually
 * removing and attaching new cards in the ai panel
 */
export class AutoAttachment extends Resource<Args> {
  cardIds: TrackedSet<string> = new TrackedSet(); // auto-attached cards
  private lastStackedItems: StackItem[] = [];
  @service declare private operatorModeStateService: OperatorModeStateService;

  modify(_positional: never[], named: Args['named']) {
    const { topMostStackItems, attachedCardIds, removedCardIds } = named;
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      return; // Don't auto-attach cards in code mode
    }

    if (this.stackItemsChanged(topMostStackItems)) {
      this.cardIds.clear();
      for (let item of topMostStackItems) {
        if (!item.url) {
          continue;
        }
        if (removedCardIds?.includes(item.url)) {
          continue;
        }
        if (attachedCardIds?.includes(item.url)) {
          continue;
        }
        this.cardIds.add(item.url);
        this.lastStackedItems = topMostStackItems;
      }
    }
  }

  private stackItemsChanged(topMostStackItems: StackItem[]) {
    if (topMostStackItems.length !== this.lastStackedItems.length) {
      return true;
    }
    for (let i = 0; i < topMostStackItems.length; i++) {
      if (topMostStackItems[i].url !== this.lastStackedItems[i].url) {
        return true;
      }
    }
    return false;
  }
}

export function getAutoAttachment(
  parent: object,
  args: {
    topMostStackItems: () => StackItem[];
    attachedCardIds: () => string[] | undefined;
    removedCardIds: () => string[] | undefined;
  },
) {
  return AutoAttachment.from(parent, () => ({
    named: {
      topMostStackItems: args.topMostStackItems(),
      attachedCardIds: args.attachedCardIds(),
      removedCardIds: args.removedCardIds(),
    },
  }));
}
