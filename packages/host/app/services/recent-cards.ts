import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export default class RecentCards extends Service {
  @tracked recentCards = new TrackedArray<CardDef>([]);

  constructor(properties: object) {
    super(properties);
    this.constructRecentCards();
  }

  get any() {
    return this.recentCards.length > 0;
  }

  async constructRecentCards() {
    const recentCardIdsString = window.localStorage.getItem('recent-cards');
    if (!recentCardIdsString) {
      return;
    }

    const recentCardIds = JSON.parse(recentCardIdsString) as string[];
    for (const recentCardId of recentCardIds) {
      const cardResource = getCard(this, () => recentCardId);
      await cardResource.loaded;
      let { card } = cardResource;
      if (!card) {
        console.warn(`cannot load card ${recentCardId}`);
        continue;
      }
      this.recentCards.push(card);
    }
  }

  addRecentCard(card: CardDef) {
    const existingCardIndex = this.recentCards.findIndex(
      (recentCard) => recentCard.id === card.id,
    );
    if (existingCardIndex !== -1) {
      this.recentCards.splice(existingCardIndex, 1);
    }

    this.recentCards.push(card);
    if (this.recentCards.length > 10) {
      this.recentCards.splice(0, 1);
    }
    const recentCardIds = this.recentCards
      .map((recentCard) => recentCard.id)
      .filter(Boolean); // don't include cards that don't have an ID
    window.localStorage.setItem('recent-cards', JSON.stringify(recentCardIds));
  }

  removeRecentCard(id: string) {
    let index = this.recentCards.findIndex((c) => c.id === id);
    if (index === -1) {
      return;
    }
    while (index !== -1) {
      this.recentCards.splice(index, 1);
      index = this.recentCards.findIndex((c) => c.id === id);
    }
    window.localStorage.setItem(
      'recent-cards',
      JSON.stringify(this.recentCards.map((c) => c.id)),
    );
  }
}
