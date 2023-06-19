import { Resource } from 'ember-resources/core';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import type MatrixService from '../services/matrix-service';
import type { RoomCard } from 'https://cardstack.com/base/room';

interface Args {
  named: {
    roomId: string;
  };
}

export class RoomCardResource extends Resource<Args> {
  @tracked roomCard: RoomCard | undefined;
  @tracked loading: Promise<void> | undefined;
  @service private declare matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    this.loading = this.load.perform(named.roomId);
  }

  private load = restartableTask(async (roomId: string) => {
    this.roomCard = await this.matrixService.roomCards.get(roomId);
  });
}

export function getRoomCard(parent: object, roomId: () => string) {
  return RoomCardResource.from(parent, () => ({
    named: {
      roomId: roomId(),
    },
  }));
}
