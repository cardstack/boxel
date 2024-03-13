import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import { clearAllRealmSessions } from '@cardstack/host/resources/realm-session';
import type LoaderService from '@cardstack/host/services/loader-service';

import type MatrixService from '@cardstack/host/services/matrix-service';
import { OperatorModeContext } from '@cardstack/host/services/matrix-service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type {
  RoomField,
  JoinEvent,
  RoomCreateEvent,
  RoomNameEvent,
  InviteEvent,
} from 'https://cardstack.com/base/room';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let nonce = 0;

export type MockMatrixService = MatrixService & {
  cardAPI: typeof cardApi;
  createAndJoinRoom(roomId: string, roomName?: string): Promise<string>;
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
function generateMockMatrixService(
  realmPermissions?: () => {
    [realmURL: string]: ('read' | 'write')[];
  },
  expiresInSec?: () => number,
) {
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

    async createRealmSession(realmURL: URL) {
      let secret = "shhh! it's a secret";
      let nowInSeconds = Math.floor(Date.now() / 1000);
      let expires =
        nowInSeconds +
        (typeof expiresInSec === 'function' ? expiresInSec() : 60 * 60);
      let header = { alg: 'none', typ: 'JWT' };
      let payload = {
        iat: nowInSeconds,
        exp: expires,
        user: this.userId,
        realm: realmURL.href,
        // adding a nonce to the test token so that we can tell the difference
        // between different tokens created in the same second
        nonce: nonce++,
        permissions: realmPermissions?.()[realmURL.href] ?? ['read', 'write'],
      };
      let stringifiedHeader = JSON.stringify(header);
      let stringifiedPayload = JSON.stringify(payload);
      let headerAndPayload = `${btoa(stringifiedHeader)}.${btoa(
        stringifiedPayload,
      )}`;
      // this is our silly JWT--we don't sign with crypto since we are running in the
      // browser so the secret is the signature
      return Promise.resolve(`${headerAndPayload}.${secret}`);
    }

    async createRoom(
      name: string,
      _invites: string[], // these can be local names
      _topic?: string,
    ): Promise<string> {
      if (document.querySelector('[data-test-throw-room-error]')) {
        throw new Error('Intentional error thrown');
      }
      return await this.createAndJoinRoom(name);
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
      let roomNameEvent: RoomNameEvent = {
        event_id: 'eventname',
        room_id: roomId,
        type: 'm.room.name',
        state_key: '@testuser:staging',
        sender: '@testuser:staging',
        origin_server_ts: Date.now(),
        content: { name: name ?? roomId },
        unsigned: { age: 0 },
      };

      await addRoomEvent(this, roomNameEvent);

      let createEvent: RoomCreateEvent = {
        event_id: 'eventcreate',
        room_id: roomId,
        type: 'm.room.create',
        state_key: '@testuser:staging',
        sender: '@testuser:staging',
        origin_server_ts: Date.now(),
        content: {
          creator: '@testuser:staging',
          room_version: '0',
        },
        unsigned: { age: 0 },
      };

      await addRoomEvent(this, createEvent);

      let joinEvent: JoinEvent = {
        event_id: 'eventjoin',
        room_id: roomId,
        type: 'm.room.member',
        sender: '@testuser:staging',
        state_key: '@testuser:staging',
        origin_server_ts: Date.now(),
        content: {
          displayname: 'testuser',
          membership: 'join',
        },
        unsigned: { age: 0 },
      };

      await addRoomEvent(this, joinEvent);

      let inviteEvent: InviteEvent = {
        event_id: 'eventinvite',
        room_id: roomId,
        type: 'm.room.member',
        sender: '@testuser:staging',
        state_key: '@aibot:localhost',
        origin_server_ts: Date.now(),
        content: {
          displayname: 'aibot',
          membership: 'invite',
        },
        unsigned: { age: 0 },
      };

      await addRoomEvent(this, inviteEvent);

      return roomId;
    }
  }
  return MockMatrixService;
}

export function setupMatrixServiceMock(
  hooks: NestedHooks,
  opts?: {
    realmPermissions?: () => {
      [realmURL: string]: ('read' | 'write')[];
    };
    expiresInSec?: () => number;
  },
) {
  hooks.beforeEach(function () {
    // clear any session refresh timers that may bleed into tests
    clearAllRealmSessions();
    this.owner.register(
      'service:matrixService',
      generateMockMatrixService(opts?.realmPermissions, opts?.expiresInSec),
    );
    let matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
  });

  hooks.afterEach(function () {
    // clear any session refresh timers that may bleed into other tests
    clearAllRealmSessions();
  });
}
