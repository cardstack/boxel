import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import { TrackedSet } from 'tracked-built-ins';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import { Submodes } from '../components/submode-switcher';

import type { Submode } from '../components/submode-switcher';

import type RealmServerService from '../services/realm-server';
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
    removedCardIds: ReadonlySet<string> | undefined;
  };
}

/**
 * Manages the auto-attachment of cards within our stack in consideration of user-actions of manually
 * removing and attaching new cards in the ai panel.
 *
 * This resource works purely with card IDs and does NOT load full card instances.
 * This is critical for performance - loading card instances triggers Babel compilation
 * of the card's entire module graph on the main thread.
 */
export class AutoAttachment extends Resource<Args> {
  cardIds: TrackedSet<string> = new TrackedSet(); // auto-attached cards
  @service declare private realmServer: RealmServerService;
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
    this.calculateAutoAttachments(
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

  private calculateAutoAttachments(
    submode: Submode,
    moduleInspectorPanel: string | undefined,
    autoAttachedFileUrls: string[] | undefined,
    playgroundPanelCardId: string | undefined,
    activeSpecId: string | null | undefined,
    topMostStackItems: StackItem[],
    attachedCardIds: string[] | undefined,
    removedCardIds: ReadonlySet<string> | undefined,
  ) {
    this.cardIds.clear();
    let realmIndexCardIds = this.realmServer.availableRealmIndexCardIds;
    if (submode === Submodes.Interact) {
      for (let item of topMostStackItems) {
        if (!item.id) {
          continue;
        }
        if (removedCardIds?.has(item.id)) {
          continue;
        }
        if (attachedCardIds?.includes(item.id)) {
          continue;
        }
        // Filter out realm index cards by URL check (no card loading needed)
        if (realmIndexCardIds.includes(item.id)) {
          continue;
        }
        this.cardIds.add(item.id);
      }
    } else if (submode === Submodes.Code) {
      let cardFileUrl = autoAttachedFileUrls?.find((url) =>
        url.endsWith('.json'),
      );
      let cardId = cardFileUrl ? cardFileUrl.replace(/\.json$/, '') : undefined;
      if (
        cardId &&
        !removedCardIds?.has(cardId) &&
        !attachedCardIds?.includes(cardId)
      ) {
        // In code mode, use store.peek() (synchronous, no compilation) to check
        // if the card is already known to be errored. If it's not in the store
        // at all, include it optimistically.
        let existing = this.store.peek(cardId);
        if (!existing || existing.constructor?.name !== 'CardError') {
          this.cardIds.add(cardId);
        }
      }
      if (
        moduleInspectorPanel === 'preview' &&
        playgroundPanelCardId &&
        !removedCardIds?.has(playgroundPanelCardId) &&
        !attachedCardIds?.includes(playgroundPanelCardId)
      ) {
        this.cardIds.add(playgroundPanelCardId);
      }
      if (
        moduleInspectorPanel === 'spec' &&
        activeSpecId &&
        !removedCardIds?.has(activeSpecId) &&
        !attachedCardIds?.includes(activeSpecId)
      ) {
        this.cardIds.add(activeSpecId);
      }
    }
  }
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
    removedCardIds: () => ReadonlySet<string> | undefined;
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
