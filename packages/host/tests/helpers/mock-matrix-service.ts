import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import { type MatrixCardError } from '@cardstack/runtime-common';

import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import type LoaderService from '@cardstack/host/services/loader-service';

import { OperatorModeContext } from '@cardstack/host/services/matrix-service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type { RoomField } from 'https://cardstack.com/base/room';
import type { RoomObjectiveField } from 'https://cardstack.com/base/room-objective';

let cardApi: typeof import('https://cardstack.com/base/card-api');

class MockClient {
  lastSentEvent: any;
  userId: string | undefined;

  constructor(userId: string | undefined) {
    this.userId = userId;
  }

  public getProfileInfo(userId: string | null) {
    return Promise.resolve({
      displayname: userId,
    });
  }
  public getThreePids() {
    return Promise.resolve({
      threepids: [
        {
          // there is also 'added_at' and 'validated_at' if we want those too
          address: 'testuser@example.com',
          medium: 'email',
        },
      ],
    });
  }
  public getUserId() {
    return this.userId;
  }
}

export class MockMatrixService extends Service {
  @service declare loaderService: LoaderService;
  lastMessageSent: any;
  // @ts-ignore
  @tracked client: MockClient = new MockClient('@testuser:staging');
  // @ts-ignore
  cardAPI!: typeof cardApi;

  profile = getMatrixProfile(this);

  // These will be empty in the tests, but we need to define them to satisfy the interface
  rooms: TrackedMap<string, Promise<RoomField>> = new TrackedMap();
  roomObjectives: TrackedMap<string, RoomObjectiveField | MatrixCardError> =
    new TrackedMap();

  async start(_auth?: any) {}

  get isLoggedIn() {
    return this.userId !== undefined;
  }
  get userId() {
    return this.client.getUserId();
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

  async sendMessage(
    roomId: string,
    body: string | undefined,
    card?: CardDef,
    context?: OperatorModeContext,
  ) {
    this.lastMessageSent = { roomId, body, card, context };
  }

  async logout() {
    this.client = new MockClient(undefined);
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

export function setupMatrixServiceMock(hooks: NestedHooks) {
  hooks.beforeEach(function () {
    this.owner.register('service:matrixService', MockMatrixService);
    let matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
  });
}
