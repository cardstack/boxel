import { service } from '@ember/service';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { TrackedSet } from 'tracked-built-ins';

import {
  isCardInstance,
  realmURL as realmURLSymbol,
} from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import { Submodes } from '../components/submode-switcher';

import type { Submode } from '../components/submode-switcher';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';

interface Args {
  named: {
    submode: Submode;
    moduleInspectorPanel: string | undefined; // 'preview' | 'spec' | 'schema' | 'card-renderer'
    autoAttachedFileUrls: string[] | undefined;
    playgroundPanelCardId: string | undefined;
    activeSpecId: string | null | undefined; // selected spec card ID from SpecPanelService
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
  @service declare private cardService: CardService;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    const {
      submode,
      moduleInspectorPanel,
      autoAttachedFileUrls,
      playgroundPanelCardId,
      activeSpecId,
      topMostStackItems,
      attachedCardIds,
      removedCardIds,
    } = named;
    this.calculateAutoAttachments.perform(
      submode,
      moduleInspectorPanel,
      autoAttachedFileUrls,
      playgroundPanelCardId,
      activeSpecId,
      topMostStackItems,
      attachedCardIds,
      removedCardIds,
    );
  }

  private calculateAutoAttachments = restartableTask(
    async (
      submode: Submode,
      moduleInspectorPanel: string | undefined,
      autoAttachedFileUrls: string[] | undefined,
      playgroundPanelCardId: string | undefined,
      activeSpecId: string | null | undefined,
      topMostStackItems: StackItem[],
      attachedCardIds: string[] | undefined,
      removedCardIds: string[] | undefined,
    ) => {
      this.cardIds.clear();
      if (submode === Submodes.Interact) {
        for (let item of topMostStackItems) {
          if (!item.id) {
            continue;
          }
          if (removedCardIds?.includes(item.id)) {
            continue;
          }
          if (attachedCardIds?.includes(item.id)) {
            continue;
          }
          let card = await this.store.get(item.id);
          if (card && isCardInstance(card)) {
            let realmURL = card[realmURLSymbol];
            if (realmURL && item.id === `${realmURL.href}index`) {
              continue;
            }
          }
          this.cardIds.add(item.id);
        }
      } else if (submode === Submodes.Code) {
        let cardFileUrl = autoAttachedFileUrls?.find((url) =>
          url.endsWith('.json'),
        );
        let cardId = cardFileUrl
          ? cardFileUrl.replace(/\.json$/, '')
          : undefined;
        if (
          cardId &&
          !removedCardIds?.includes(cardId) &&
          !attachedCardIds?.includes(cardId)
        ) {
          this.cardIds.add(cardId);
        }
        if (
          moduleInspectorPanel === 'preview' &&
          playgroundPanelCardId &&
          !removedCardIds?.includes(playgroundPanelCardId) &&
          !attachedCardIds?.includes(playgroundPanelCardId)
        ) {
          this.cardIds.add(playgroundPanelCardId);
        }
        if (
          moduleInspectorPanel === 'spec' &&
          activeSpecId &&
          !removedCardIds?.includes(activeSpecId) &&
          !attachedCardIds?.includes(activeSpecId)
        ) {
          this.cardIds.add(activeSpecId);
        }
      }
    },
  );
}

export function getAutoAttachment(
  parent: object,
  args: {
    submode: () => Submode;
    moduleInspectorPanel: () => string | undefined;
    autoAttachedFileUrls: () => string[] | undefined;
    playgroundPanelCardId: () => string | undefined;
    activeSpecId: () => string | null | undefined;
    topMostStackItems: () => StackItem[];
    attachedCardIds: () => string[] | undefined;
    removedCardIds: () => string[] | undefined;
  },
) {
  return AutoAttachment.from(parent, () => ({
    named: {
      submode: args.submode(),
      moduleInspectorPanel: args.moduleInspectorPanel(),
      autoAttachedFileUrls: args.autoAttachedFileUrls(),
      playgroundPanelCardId: args.playgroundPanelCardId(),
      activeSpecId: args.activeSpecId(),
      topMostStackItems: args.topMostStackItems(),
      attachedCardIds: args.attachedCardIds(),
      removedCardIds: args.removedCardIds(),
    },
  }));
}
