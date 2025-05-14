import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { isCardInstance, localId, isLocalId } from '@cardstack/runtime-common';

import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { RecentCards } from '../utils/local-storage-keys';

import type CardService from './card-service';
import type RecentFilesService from './recent-files-service';
import type ResetService from './reset';
import type StoreService from './store';

export default class RecentCardsService extends Service {
  @service declare private reset: ResetService;
  @service declare private cardService: CardService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private store: StoreService;
  @tracked private ascendingRecentCardIds = new TrackedArray<string>([]);
  private cachedAPI?: typeof CardAPI;
  private addToRecentFiles = new Set<string>();

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);

    const recentCardIdsString = window.localStorage.getItem(RecentCards);
    if (recentCardIdsString) {
      const recentCardIds = JSON.parse(recentCardIdsString) as string[];
      this.ascendingRecentCardIds.push(...recentCardIds);
    }
  }

  @cached
  // return in descending order: most recent to oldest
  get recentCardIds() {
    return [...this.ascendingRecentCardIds].reverse();
  }

  resetState() {
    this.ascendingRecentCardIds = new TrackedArray([]);
  }

  add(newId: string) {
    if (isLocalId(newId)) {
      let instance = this.store.peek(newId);
      if (isCardInstance(instance)) {
        this.addNewCard(instance);
      }
    }
    const existingCardIndex = this.ascendingRecentCardIds.findIndex(
      (id) => id === newId,
    );
    if (existingCardIndex !== -1) {
      this.ascendingRecentCardIds.splice(existingCardIndex, 1);
    }

    this.ascendingRecentCardIds.push(newId);
    if (this.ascendingRecentCardIds.length > 10) {
      this.ascendingRecentCardIds.splice(0, 1);
    }
    window.localStorage.setItem(
      RecentCards,
      JSON.stringify(this.ascendingRecentCardIds),
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
    let index = this.ascendingRecentCardIds.findIndex(
      (id) => id === idToRemove,
    );
    if (index === -1) {
      return;
    }
    while (index !== -1) {
      this.ascendingRecentCardIds.splice(index, 1);
      index = this.ascendingRecentCardIds.findIndex((id) => id === idToRemove);
    }
    window.localStorage.setItem(
      'recent-cards',
      JSON.stringify(this.ascendingRecentCardIds),
    );
  }
}
