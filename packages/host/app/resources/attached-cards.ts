import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { restartableTask, all } from 'ember-concurrency';
import { service } from '@ember/service';
import type CardService from '../services/card-service';
import { type RoomCard } from 'https://cardstack.com/base/room';
import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: { roomCard: RoomCard | undefined; ids: string[] };
}

export class AttachedCards extends Resource<Args> {
  @service declare cardService: CardService;
  @tracked instances: CardDef[] = [];

  modify(_positional: never[], named: Args['named']) {
    let { roomCard, ids } = named;
    this.load.perform(roomCard, ids);
  }

  private load = restartableTask(
    async (roomCard: RoomCard | undefined, ids: string[]) => {
      if (!roomCard) {
        this.instances = [];
        return;
      }
      let RoomCardClazz = Reflect.getPrototypeOf(roomCard)!
        .constructor as typeof RoomCard;
      let pendingCards: Promise<CardDef>[] = [];
      for (let id of ids) {
        let pendingCard = RoomCardClazz.getAttachedCard(id);
        if (!pendingCard) {
          pendingCard = this.cardService.loadModel(new URL(id));
          RoomCardClazz.setAttachedCard(id, pendingCard);
        }
        pendingCards.push(pendingCard);
      }
      this.instances = await all(pendingCards);
    },
  );
}

export function getAttachedCards(
  parent: object,
  roomCard: () => RoomCard | undefined,
  ids: () => string[],
) {
  return AttachedCards.from(parent, () => ({
    named: {
      roomCard: roomCard(),
      ids: ids(),
    },
  })) as AttachedCards;
}
