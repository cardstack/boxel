import { tracked } from '@glimmer/tracking';
import { DndColumn } from '@cardstack/boxel-ui/components';
import { CardDef } from 'https://cardstack.com/base/card-api';

import { Resource } from 'ember-modify-based-class-resource';

interface Args {
  named: {
    cards: CardDef[];
    // Custom getter that is describe to access a way to access the data of the card
    // that is equal to the column
    hasColumnKey: <T extends CardDef>(card: T, key: string) => boolean;
    columnKeys: string[];
    orderBy?: <T extends CardDef>(a: T, b: T) => number;
  };
}

// This is a resource because we have to
// 1. to hold state of cards inside of the kanban board without a flickering/ loading
// 2. to maintain a natural order cards that are newly added to the kanban board
// Note: this resource assumes that you have already loaded the cards and is unsuitable for pre-rendered cards
class KanbanResource extends Resource<Args> {
  @tracked private data: Map<string, DndColumn> = new Map();
  hasColumnKey?: <T extends CardDef>(card: T, key: string) => boolean =
    undefined;
  orderBy?: <T extends CardDef>(a: T, b: T) => number = undefined;

  commit(cards: CardDef[], columnKeys: string[]) {
    columnKeys.forEach((key: string) => {
      let currentColumn = this.data.get(key);
      let cardsForStatus = cards.filter((card) => {
        return this.hasColumnKey ? this.hasColumnKey(card, key) : false;
      });

      if (currentColumn) {
        // Maintain order of existing cards and append new ones
        let existingCardIds = new Set(
          currentColumn.cards.map((card: CardDef) => card.id),
        );
        let existingCards = currentColumn.cards.filter((card: CardDef) =>
          cardsForStatus.some((c) => c.id === card.id),
        );
        let newCards = cardsForStatus.filter(
          (card: CardDef) => !existingCardIds.has(card.id),
        );

        let sortedCards = [...newCards, ...existingCards];
        if (this.orderBy) {
          sortedCards = sortedCards.sort(this.orderBy);
        }
        this.data.set(key, new DndColumn(key, sortedCards));
      } else {
        // First time loading this column
        let sortedCards = cardsForStatus;
        if (this.orderBy) {
          sortedCards = sortedCards.sort(this.orderBy);
        }
        this.data.set(key, new DndColumn(key, sortedCards));
      }
    });
  }

  get columns() {
    return Array.from(this.data.values());
  }

  modify(_positional: never[], named: Args['named']) {
    this.hasColumnKey = named.hasColumnKey;
    this.orderBy = named.orderBy;
    this.commit(named.cards, named.columnKeys);
  }
}

export default function getKanbanResource<T extends CardDef>(
  parent: object,
  cards: () => T[],
  columnKeys: () => string[],
  hasColumnKey: () => (card: T, key: string) => boolean,
  orderBy: () => (<T extends CardDef>(a: T, b: T) => number) | undefined,
) {
  return KanbanResource.from(parent, () => ({
    named: {
      cards: cards(),
      columnKeys: columnKeys(),
      hasColumnKey: hasColumnKey() as <T extends CardDef>(
        card: T,
        key: string,
      ) => boolean,
      orderBy: orderBy?.(),
    },
  }));
}
