import { getCards } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { DndColumn, DndItem } from '@cardstack/boxel-ui/components';
import { type Query } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { TaskStatusField, type LooseyGooseyData, Task } from './task';

import { isEqual } from 'lodash';
import { Resource } from 'ember-resources';

interface Args {
  named: {
    query: Query;
    realm: string;
  };
}

// This is a resource because we have to consider 3 data mechanism
// 1. the reactivity of the query. Changes in query should trigger server fetch
// 2. the drag and drop of cards. When dragging and dropping, we should NOT trigger a server fetch
//    but rather just update the local data structure
// 3. When we trigger a server fetch, we need to maintain the sort order of the cards.
//   Currently, we don't have any mechanism to maintain the sort order but this is good enough for now
class TaskCollection extends Resource<Args> {
  @tracked private data: Map<string, DndColumn> = new Map();
  @tracked private order: Map<string, string[]> = new Map();
  @tracked private query: Query | undefined = undefined;

  private run = restartableTask(async (query: Query, realm: string) => {
    let staticQuery = getCards(query, [realm]);
    await staticQuery.loaded;
    let cards = staticQuery.instances as Task[];
    this.commit(cards); //update stale data

    this.query = query;
  });

  queryHasChanged(query: Query) {
    return !isEqual(this.query, query);
  }

  commit(cards: Task[]) {
    TaskStatusField.values?.map((status: LooseyGooseyData) => {
      let statusLabel = status.label;
      let cardIdsFromOrder = this.order.get(statusLabel);
      let newCards: Task[] = [];
      if (cardIdsFromOrder) {
        newCards = cardIdsFromOrder.reduce((acc: Task[], id: string) => {
          let card = cards.find((c) => c.id === id);
          if (card) {
            acc.push(card);
          }
          return acc;
        }, []);
      } else {
        newCards = cards.filter((task) => task.status.label === statusLabel);
      }
      this.data.set(statusLabel, new DndColumn(statusLabel, newCards));
    });
  }

  // Note:
  // sourceColumnAfterDrag & targetColumnAfterDrag is the column state after the drag and drop
  update(
    draggedCard: DndItem,
    _targetCard: DndItem | undefined,
    sourceColumnAfterDrag: DndColumn,
    targetColumnAfterDrag: DndColumn,
  ) {
    let status = TaskStatusField.values.find(
      (value) => value.label === targetColumnAfterDrag.title,
    );
    let cardInNewCol = targetColumnAfterDrag.cards.find(
      (c: Task) => c.id === draggedCard.id,
    );
    if (cardInNewCol) {
      cardInNewCol.status.label = status?.label;
      cardInNewCol.status.index = status?.index;
    }
    //update the order of the cards in the column
    this.order.set(
      sourceColumnAfterDrag.title,
      sourceColumnAfterDrag.cards.map((c: Task) => c.id),
    );
    this.order.set(
      targetColumnAfterDrag.title,
      targetColumnAfterDrag.cards.map((c: Task) => c.id),
    );
    return cardInNewCol;
  }

  get columns() {
    return Array.from(this.data.values());
  }

  modify(_positional: never[], named: Args['named']) {
    if (this.query === undefined || this.queryHasChanged(named.query)) {
      this.run.perform(named.query, named.realm);
    }
  }
}

export default function getTaskCardsResource(
  parent: object,
  query: () => Query,
  realm: () => string,
) {
  return TaskCollection.from(parent, () => ({
    named: {
      realm: realm(),
      query: query(),
    },
  }));
}
