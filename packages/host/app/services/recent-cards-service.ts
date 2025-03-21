import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import type ResetService from './reset';

export default class RecentCardsService extends Service {
  @service declare private reset: ResetService;
  @tracked private ascendingRecentCardIds = new TrackedArray<string>([]);

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);

    const recentCardIdsString = window.localStorage.getItem('recent-cards');
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
      'recent-cards',
      JSON.stringify(this.ascendingRecentCardIds),
    );
  }

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
