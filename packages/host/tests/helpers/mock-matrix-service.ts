import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import { type MatrixCardError } from '@cardstack/runtime-common';

import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import type LoaderService from '@cardstack/host/services/loader-service';

import type { RoomField } from 'https://cardstack.com/base/room';
import type { RoomObjectiveField } from 'https://cardstack.com/base/room-objective';

let cardApi: typeof import('https://cardstack.com/base/card-api');

class MockClient {
  public getProfileInfo(userId: string) {
    return new Promise((resolveOuter) => {
      resolveOuter({ displayname: userId });
    });
  }
}

export class MockMatrixService extends Service {
  @service declare loaderService: LoaderService;

  cardAPI!: typeof cardApi;
  // These will be empty in the tests, but we need to define them to satisfy the interface
  rooms: TrackedMap<string, Promise<RoomField>> = new TrackedMap();
  roomObjectives: TrackedMap<string, RoomObjectiveField | MatrixCardError> =
    new TrackedMap();

  async start(_auth?: any) {}

  get isLoggedIn() {
    return true;
  }

  get client() {
    return new MockClient();
  }

  get userId() {
    return '@testuser:staging';
  }

  async allowedToSetObjective(_roomId: string): Promise<boolean> {
    return false;
  }

  async createRoom(
    name: string,
    _invites: string[], // these can be local names
    _topic?: string,
  ): Promise<string> {
    return name;
  }

  public createAndJoinRoom(roomId: string) {
    addRoomEvent(this, {
      event_id: 'eventname',
      room_id: roomId,
      type: 'm.room.name',
      content: {
        name: 'test_a',
      },
    });

    addRoomEvent(this, {
      event_id: 'eventname',
      room_id: roomId,
      type: 'm.room.create',
      origin_server_ts: 0,
      content: {
        creator: '@testuser:staging',
        room_version: '0',
      },
    });

    addRoomEvent(this, {
      event_id: 'eventjoin',
      room_id: roomId,
      type: 'm.room.member',
      sender: '@testuser:staging',
      state_key: '@testuser:staging',
      content: {
        displayname: 'testuser',
        membership: 'join',
        membershipTs: 1,
        membershipInitiator: '@testuser:staging',
      },
    });
  }
}
