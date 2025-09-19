import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import {
  isCardInstance,
  localId,
  isLocalId,
  trimJsonExtension,
} from '@cardstack/runtime-common';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { RecentCards } from '../utils/local-storage-keys';

import type CardService from './card-service';
import type RecentFilesService from './recent-files-service';
import type ResetService from './reset';
import type StoreService from './store';

export interface RecentCard {
  cardId: string;
  timestamp?: number;
}

export default class RecentCardsService extends Service {
  @service declare private reset: ResetService;
  @service declare private cardService: CardService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private store: StoreService;
  @tracked private ascendingRecentCards = new TrackedArray<RecentCard>([]);
  private cachedAPI?: typeof CardAPI;
  private addToRecentFiles = new Set<string>();

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);

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
    this.ascendingRecentCards = new TrackedArray([]);
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
  }

  async addNewCard(instance: CardDef, opts?: { addToRecentFiles?: true }) {
    if (instance.id) {
      this.add(instance.id);
      if (opts?.addToRecentFiles) {
        this.recentFilesService.addRecentFileUrl(instance.id);
      }
    } else {
      this.cachedAPI = await this.cardService.getAPI();
      if (opts?.addToRecentFiles) {
        this.addToRecentFiles.add(instance[localId]);
      }
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
}

declare module '@ember/service' {
  interface Registry {
    'recent-cards-service': RecentCardsService;
  }
}
