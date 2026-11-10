import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { waitForPromise } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import {
  isCardInstance,
  localId,
  isLocalId,
  logger,
  trimJsonExtension,
} from '@cardstack/runtime-common';

import { RecentCards } from '../utils/local-storage-keys';

import type CardService from './card-service';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type RecentFilesService from './recent-files-service';
import type SessionService from './session';
import type StoreService from './store';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef, BaseDef } from '@cardstack/base/card-api';

const log = logger('service:recent-cards-service');

export interface RecentCard {
  cardId: string;
  timestamp?: number;
}

export default class RecentCardsService extends Service {
  @service declare private session: SessionService;
  @service declare private cardService: CardService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private store: StoreService;
  @service declare private network: NetworkService;
  @service declare private matrixService: MatrixService;
  @tracked private ascendingRecentCards = new TrackedArray<RecentCard>([]);
  private cachedAPI?: typeof CardAPI;
  private addToRecentFiles = new Set<string>();
  private pendingCardIdSubscriptions = new Map<string, CardDef>();
  // The pending write recording an opened card, so only one is out at once.
  private openedCardRecording: Promise<void> | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.session.register(this);
    registerDestructor(this, () => {
      this.clearPendingCardIdSubscriptions();
    });

    const recentCardsString = window.localStorage.getItem(RecentCards);
    if (recentCardsString) {
      const recentCards: RecentCard[] = JSON.parse(recentCardsString).map(
        (c: RecentCard | string) => ({
          cardId: trimJsonExtension(typeof c === 'string' ? c : c.cardId),
          timestamp: typeof c === 'string' ? Date.now() : c.timestamp,
        }),
      );
      this.ascendingRecentCards.push(...recentCards);
    }
  }

  @cached
  // return in descending order: most recent to oldest
  get recentCards(): RecentCard[] {
    return [...this.ascendingRecentCards].reverse();
  }

  @cached
  // return in descending order: most recent to oldest
  get recentCardIds(): string[] {
    return this.recentCards.map((c) => c.cardId);
  }

  resetState() {
    this.openedCardRecording = undefined;
    this.clearPendingCardIdSubscriptions();
    this.ascendingRecentCards = new TrackedArray([]);
    this.addToRecentFiles.clear();
  }

  private findRecentCardIndex(id: string) {
    return this.ascendingRecentCards.findIndex(
      (item) => item.cardId === trimJsonExtension(id),
    );
  }

  add(newId: string) {
    if (isLocalId(newId)) {
      let instance = this.store.peek(newId);
      if (isCardInstance(instance)) {
        this.addNewCard(instance);
      }
      return;
    }

    const existingCardIndex = this.findRecentCardIndex(newId);
    if (existingCardIndex !== -1) {
      this.ascendingRecentCards.splice(existingCardIndex, 1);
    }
    this.ascendingRecentCards.push({
      cardId: newId,
      timestamp: Date.now(),
    });
    if (this.ascendingRecentCards.length > 10) {
      this.ascendingRecentCards.splice(0, 1);
    }
    window.localStorage.setItem(
      RecentCards,
      JSON.stringify(this.ascendingRecentCards),
    );
    this.recordOpenedCard();
  }

  // Recent cards are kept per browser, so the account also records that a
  // card was opened, for Get started's open-card step in every browser. Only
  // cards opened in this session count: the browser's list may be another
  // account's. A write that fails or is dropped is only logged; the next card
  // opened tries again.
  private recordOpenedCard() {
    if (
      !this.session.isAuthenticated ||
      this.openedCardRecording ||
      !this.matrixService.isDashboardStateLoaded ||
      this.matrixService.dashboardState.openedCard
    ) {
      return;
    }
    let recording: Promise<void> = this.matrixService
      .updateDashboardState({ openedCard: true })
      .catch((error: unknown) => {
        log.warn(`recording that a card was opened failed: ${error}`);
      })
      .finally(() => {
        // A logout since may have started another.
        if (this.openedCardRecording === recording) {
          this.openedCardRecording = undefined;
        }
      });
    this.openedCardRecording = recording;
    // Nothing awaits it, so tests' settled() waits on it here.
    waitForPromise(recording);
  }

  async addNewCard(instance: CardDef, opts?: { addToRecentFiles?: true }) {
    if (instance.id) {
      this.add(instance.id);
      if (opts?.addToRecentFiles) {
        this.recentFilesService.addRecentFileUrl(instance.id);
      }
    } else {
      this.cachedAPI = await this.cardService.getAPI();
      if (this.pendingCardIdSubscriptions.has(instance[localId])) {
        if (opts?.addToRecentFiles) {
          this.addToRecentFiles.add(instance[localId]);
        }
        return;
      }
      if (opts?.addToRecentFiles) {
        this.addToRecentFiles.add(instance[localId]);
      }
      this.pendingCardIdSubscriptions.set(instance[localId], instance);
      this.cachedAPI.subscribeToChanges(instance, this.listenForCardId);
    }
  }

  private listenForCardId = (instance: BaseDef, field: string) => {
    if (field === 'id' && isCardInstance(instance) && instance.id) {
      this.add(instance.id);
      if (this.addToRecentFiles.has(instance[localId])) {
        this.recentFilesService.addRecentFileUrl(`${instance.id}.json`);
        this.addToRecentFiles.delete(instance[localId]);
      }
      this.pendingCardIdSubscriptions.delete(instance[localId]);
      this.cachedAPI?.unsubscribeFromChanges(instance, this.listenForCardId);
    }
  };

  remove(idToRemove: string) {
    let index = this.findRecentCardIndex(idToRemove);
    if (index === -1) {
      return;
    }
    while (index !== -1) {
      this.ascendingRecentCards.splice(index, 1);
      index = this.findRecentCardIndex(idToRemove);
    }
    window.localStorage.setItem(
      'recent-cards',
      JSON.stringify(this.ascendingRecentCards),
    );
  }

  private clearPendingCardIdSubscriptions() {
    if (this.cachedAPI) {
      for (let instance of this.pendingCardIdSubscriptions.values()) {
        this.cachedAPI.unsubscribeFromChanges(instance, this.listenForCardId);
      }
    }
    this.pendingCardIdSubscriptions.clear();
  }
}

declare module '@ember/service' {
  interface Registry {
    'recent-cards-service': RecentCardsService;
  }
}
