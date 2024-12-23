import { tracked } from '@glimmer/tracking';
import { DndColumn } from '@cardstack/boxel-ui/components';
import { CardDef } from 'https://cardstack.com/base/card-api';

import { Resource } from 'ember-resources';

interface Args {
  named: {
    cards: CardDef[];
    hasColumnKey: (card: any, key: string) => boolean;
    columnKeys: string[];
  };
}

// This is a resource because we have to
// 1. to hold state of cards inside of the kanban board
// 2. to order cards that are newly added to the kanban board
class TaskCollection extends Resource<Args> {
  @tracked private data: Map<string, DndColumn> = new Map();
  hasColumnKey?: (card: CardDef, key: string) => boolean = undefined;

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
        this.data.set(key, new DndColumn(key, [...newCards, ...existingCards]));
      } else {
        // First time loading this column
        this.data.set(key, new DndColumn(key, cardsForStatus));
      }
    });
  }

  get columns() {
    return Array.from(this.data.values());
  }

  modify(_positional: never[], named: Args['named']) {
    this.hasColumnKey = named.hasColumnKey;
    this.commit(named.cards, named.columnKeys);
  }
}

export default function getTaskCardsResource(
  parent: object,
  cards: () => CardDef[],
  columnKeys: () => string[],
  hasColumnKey: () => (card: any, key: string) => boolean,
) {
  return TaskCollection.from(parent, () => ({
    named: {
      cards: cards(),
      columnKeys: columnKeys(),
      hasColumnKey: hasColumnKey(),
    },
  }));
}
