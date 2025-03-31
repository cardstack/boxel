import { service } from '@ember/service';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedSet } from 'tracked-built-ins';

import { isCardInstance } from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import { Submodes } from '../components/submode-switcher';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

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
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private cardService: CardService;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    const { topMostStackItems, attachedCardIds, removedCardIds } = named;
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      return; // Don't auto-attach cards in code mode
    }

    this.calculateAutoAttachments.perform(
      topMostStackItems,
      attachedCardIds,
      removedCardIds,
    );
  }

  private calculateAutoAttachments = restartableTask(
    async (
      topMostStackItems: StackItem[],
      attachedCardIds: string[] | undefined,
      removedCardIds: string[] | undefined,
    ) => {
      let api = await this.cardService.getAPI();
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
        let card = await this.store.peek(item.url);
        if (card && isCardInstance(card)) {
          let realmURL = card[api.realmURL];
          if (realmURL && item.url === `${realmURL.href}index`) {
            continue;
          }
        }
        this.cardIds.add(item.url);
      }
    },
  );
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
