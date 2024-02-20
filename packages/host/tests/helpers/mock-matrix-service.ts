import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import type LoaderService from '@cardstack/host/services/loader-service';

import type MatrixService from '@cardstack/host/services/matrix-service';
import { OperatorModeContext } from '@cardstack/host/services/matrix-service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type { RoomField } from 'https://cardstack.com/base/room';

let cardApi: typeof import('https://cardstack.com/base/card-api');

export type MockMatrixService = MatrixService & {
  cardAPI: typeof cardApi;
  createAndJoinRoom(roomId: string, roomName?: string): Promise<void>;
  lastMessageSent: any;
};

class MockClient {
  lastSentEvent: any;
  userId?: string;
  displayname?: string;

  constructor(userId?: string, displayname?: string) {
    this.userId = userId;
    this.displayname = displayname;
  }

  get isLoggedIn() {
    return this.userId !== undefined;
  }

  public getProfileInfo(_userId: string | null) {
    return Promise.resolve({
      displayname: this.displayname,
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
function generateMockMatrixService() {
  class MockMatrixService extends Service implements MockMatrixService {
    @service declare loaderService: LoaderService;
    lastMessageSent: any;
    // @ts-ignore
    @tracked client: MockClient = new MockClient('@testuser:staging', '');
    // @ts-ignore
    cardAPI!: typeof cardApi;

    profile = getMatrixProfile(this, () => this.userId);

    // These will be empty in the tests, but we need to define them to satisfy the interface
    rooms: TrackedMap<string, Promise<RoomField>> = new TrackedMap();

    async start(_auth?: any) {}

    get isLoggedIn() {
      return this.userId !== undefined;
    }
    get userId() {
      return this.client.getUserId();
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
      cards?: CardDef[],
      context?: OperatorModeContext,
    ) {
      this.lastMessageSent = { roomId, body, cards, context };
    }

    async logout() {
      this.client = new MockClient(undefined);
    }

    async setDisplayName(displayName: string) {
      this.client.displayname = displayName;
      return Promise.resolve();
    }

    async reloadProfile() {
      await this.profile.load.perform();
    }

    async createAndJoinRoom(roomId: string, name?: string) {
      await addRoomEvent(this, {
        event_id: 'eventname',
        room_id: roomId,
        type: 'm.room.name',
        content: {
          name: name || 'test_a',
        },
      });

      await addRoomEvent(this, {
        event_id: 'eventcreate',
        room_id: roomId,
        type: 'm.room.create',
        origin_server_ts: Date.now(),
        content: {
          creator: '@testuser:staging',
          room_version: '0',
        },
      });

      await addRoomEvent(this, {
        event_id: 'eventjoin',
        room_id: roomId,
        type: 'm.room.member',
        sender: '@testuser:staging',
        state_key: '@testuser:staging',
        origin_server_ts: Date.now(),
        content: {
          displayname: 'testuser',
          membership: 'join',
          membershipTs: Date.now(),
          membershipInitiator: '@testuser:staging',
        },
      });

      addRoomEvent(this, {
        event_id: 'eventinvite',
        room_id: roomId,
        type: 'm.room.member',
        sender: '@testuser:staging',
        state_key: '@aibot:localhost',
        content: {
          displayname: 'aibot',
          membership: 'invite',
        },
      });
    }
  }
  return MockMatrixService;
}

export function setupMatrixServiceMock(hooks: NestedHooks) {
  hooks.beforeEach(function () {
    this.owner.register('service:matrixService', generateMockMatrixService());
    let matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
  });
}
