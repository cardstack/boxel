import { registerDestructor } from '@ember/destroyable';
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
    removedCardIds: ReadonlySet<string> | undefined;
  };
}

/**
 * Manages the auto-attachment of cards within our stack in consideration of user-actions of manually
 * removing and attaching new cards in the ai panel
 */
export class AutoAttachment extends Resource<Args> {
  cardIds: TrackedSet<string> = new TrackedSet(); // auto-attached cards
  #hasRegisteredDestructor = false;
  #referenceCounts = new Map<string, number>();
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
    this.reconcileReferences(
      this.getCandidateCardIds(
        submode,
        moduleInspectorPanel,
        autoAttachedFileUrls,
        playgroundPanelCardId,
        activeSpecId,
        topMostStackItems,
        attachedCardIds,
        removedCardIds,
      ),
    );
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
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      registerDestructor(this, () => {
        for (let [id, count] of this.#referenceCounts) {
          for (let i = 0; i < count; i++) {
            this.store.dropReference(id);
          }
        }
        this.#referenceCounts.clear();
      });
    }
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
      removedCardIds: ReadonlySet<string> | undefined,
    ) => {
      this.cardIds.clear();
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
          let card = await this.loadCard(item.id);
          if (!card || !isCardInstance(card)) {
            continue;
          }
          let realmURL = card[realmURLSymbol];
          if (realmURL && item.id === `${realmURL.href}index`) {
            continue;
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
          !removedCardIds?.has(cardId) &&
          !attachedCardIds?.includes(cardId)
        ) {
          let card = await this.loadCard(cardId);
          if (card && isCardInstance(card)) {
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
    },
  );

  private async loadCard(id: string) {
    let existing = this.store.peek(id);
    if (existing) {
      return existing;
    }
    return await this.store.get(id);
  }

  private getCandidateCardIds(
    submode: Submode,
    moduleInspectorPanel: string | undefined,
    autoAttachedFileUrls: string[] | undefined,
    playgroundPanelCardId: string | undefined,
    activeSpecId: string | null | undefined,
    topMostStackItems: StackItem[],
    attachedCardIds: string[] | undefined,
    removedCardIds: ReadonlySet<string> | undefined,
  ) {
    let candidateIds: string[] = [];

    if (submode === Submodes.Interact) {
      for (let item of topMostStackItems) {
        if (
          item.id &&
          !removedCardIds?.has(item.id) &&
          !attachedCardIds?.includes(item.id)
        ) {
          candidateIds.push(item.id);
        }
      }
      return candidateIds;
    }

    if (submode !== Submodes.Code) {
      return candidateIds;
    }

    let cardFileUrl = autoAttachedFileUrls?.find((url) =>
      url.endsWith('.json'),
    );
    let cardId = cardFileUrl ? cardFileUrl.replace(/\.json$/, '') : undefined;
    if (
      cardId &&
      !removedCardIds?.has(cardId) &&
      !attachedCardIds?.includes(cardId)
    ) {
      candidateIds.push(cardId);
    }

    if (
      moduleInspectorPanel === 'preview' &&
      playgroundPanelCardId &&
      !removedCardIds?.has(playgroundPanelCardId) &&
      !attachedCardIds?.includes(playgroundPanelCardId)
    ) {
      candidateIds.push(playgroundPanelCardId);
    }

    if (
      moduleInspectorPanel === 'spec' &&
      activeSpecId &&
      !removedCardIds?.has(activeSpecId) &&
      !attachedCardIds?.includes(activeSpecId)
    ) {
      candidateIds.push(activeSpecId);
    }

    return candidateIds;
  }

  private reconcileReferences(targetIds: string[]) {
    let targetCounts = this.countReferences(targetIds);

    for (let [id, currentCount] of this.#referenceCounts) {
      let targetCount = targetCounts.get(id) ?? 0;
      if (currentCount > targetCount) {
        this.dropReference(id, currentCount - targetCount);
      }
    }

    for (let [id, targetCount] of targetCounts) {
      let currentCount = this.#referenceCounts.get(id) ?? 0;
      if (targetCount > currentCount) {
        this.addReference(id, targetCount - currentCount);
      }
    }
  }

  private countReferences(ids: string[]) {
    let counts = new Map<string, number>();
    for (let id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  private addReference(id: string, count = 1) {
    if (!id || count <= 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      this.store.addReference(id);
    }
    this.#referenceCounts.set(id, (this.#referenceCounts.get(id) ?? 0) + count);
  }

  private dropReference(id: string, count = 1) {
    if (!id || count <= 0) {
      return;
    }
    let currentCount = this.#referenceCounts.get(id);
    if (!currentCount) {
      return;
    }
    let drops = Math.min(count, currentCount);
    for (let i = 0; i < drops; i++) {
      this.store.dropReference(id);
    }
    let remaining = currentCount - drops;
    if (remaining <= 0) {
      this.#referenceCounts.delete(id);
    } else {
      this.#referenceCounts.set(id, remaining);
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
