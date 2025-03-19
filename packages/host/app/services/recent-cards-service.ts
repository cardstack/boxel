import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type ResetService from './reset';

export default class RecentCardsService extends Service {
  @service declare private reset: ResetService;
  @tracked declare recentCards: TrackedArray<CardDef>;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);
    this.constructRecentCards.perform();
  }

  get any() {
    return this.recentCards.length > 0;
  }

  resetState() {
    this.recentCards = new TrackedArray([]);
  }

  add(card: CardDef) {
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

  remove(id: string) {
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

  private constructRecentCards = task(async () => {
    const recentCardIdsString = window.localStorage.getItem('recent-cards');
    if (!recentCardIdsString) {
      return;
    }

    const recentCardIds = JSON.parse(recentCardIdsString) as string[];
    for (const recentCardId of recentCardIds) {
      // TODO This seems dubious. RecentCardsService probably should not be
      // dealing in CardDef's but rather card id's. if consumers want an
      // instantiated card they can use getCard on their own instead of relying
      // on this to instantiate cards for them. Please refactor as part of
      // removing the CardResource.loaded promise.
      const cardResource = getCard(this, () => recentCardId);
      await cardResource.loaded;
      let { card } = cardResource;
      if (!card) {
        console.warn(`cannot load card ${recentCardId}`);
        continue;
      }
      this.recentCards.push(card);
    }
  });
}
