import Service, { service } from '@ember/service';
import { cached, tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import { v4 as uuid } from 'uuid';

import { Deferred } from '@cardstack/runtime-common';

import { baseRealm, LooseCardResource } from '@cardstack/runtime-common';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';
import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import { RoomResource, getRoom } from '@cardstack/host/resources/room';
import CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type MatrixService from '@cardstack/host/services/matrix-service';
import { OperatorModeContext } from '@cardstack/host/services/matrix-service';

import RealmService from '@cardstack/host/services/realm';

import { CardDef } from 'https://cardstack.com/base/card-api';
import { CommandField } from 'https://cardstack.com/base/command';
import type {
  CommandResultContent,
  ReactionEventContent,
} from 'https://cardstack.com/base/matrix-event';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let nonce = 0;

export type MockMatrixService = MatrixService & {
  sendReactionDeferred: Deferred<void>; // used to assert applying state in apply button
  cardAPI: typeof cardApi;
  createAndJoinRoom(roomId: string, roomName?: string): Promise<string>;
};

class MockClient {
  matrixService: MockMatrixService;
  lastSentEvent: any;
  userId?: string;
  displayname?: string;

  constructor(
    matrixService: MockMatrixService,
    userId?: string,
    displayname?: string,
  ) {
    this.matrixService = matrixService;
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

  public sendReadReceipt(event: { getId: () => string }) {
    this.matrixService.addEventReadReceipt(event.getId(), {
      readAt: new Date(),
    });
  }
}
function generateMockMatrixService(
  realmPermissions?: () => {
    [realmURL: string]: ('read' | 'write')[];
  },
  expiresInSec?: () => number | undefined,
) {
  class MockMatrixService extends Service implements MockMatrixService {
    @service declare cardService: CardService;
    @service declare realm: RealmService;
    @service declare loaderService: LoaderService;

    // @ts-ignore
    @tracked client: MockClient = new MockClient(this, '@testuser:staging', '');
    // @ts-ignore
    cardAPI!: typeof cardApi;

    profile = getMatrixProfile(this, () => this.userId);

    rooms: TrackedMap<string, RoomState> = new TrackedMap();
    roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();

    messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
    cardsToSend: TrackedMap<string, CardDef[] | undefined> = new TrackedMap();
    failedCommandState: TrackedMap<string, Error> = new TrackedMap();
    currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
      new TrackedMap();

    async start(_auth?: any) {
      await this.loginToRealms();
    }

    private async loginToRealms() {
      // This is where we would actually load user-specific choices out of the
      // user's profile based on this.client.getUserId();
      let activeRealms = this.cardService.realmURLs;

      await Promise.all(
        activeRealms.map(async (realmURL) => {
          try {
            // Our authorization-middleware can login automatically after seeing a
            // 401, but this preemptive login makes it possible to see
            // canWrite==true on realms that are publicly readable.
            await this.realm.login(realmURL);
          } catch (err) {
            console.warn(
              `Unable to establish session with realm ${realmURL}`,
              err,
            );
          }
        }),
      );
    }
    sendReactionDeferred?: Deferred<void>; // used to assert applying state in apply button

    get isLoggedIn() {
      return this.userId !== undefined;
    }
    get userId() {
      return this.client.getUserId();
    }

    async createRealmSession(realmURL: URL) {
      let secret = "shhh! it's a secret";
      let nowInSeconds = Math.floor(Date.now() / 1000);
      let expires = nowInSeconds + (expiresInSec?.() ?? 60 * 60);
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

    addEventReadReceipt(eventId: string, readAt: Date) {
      this.currentUserEventReadReceipts.set(eventId, { readAt });
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

    async sendReactionEvent(roomId: string, eventId: string, status: string) {
      let content: ReactionEventContent = {
        'm.relates_to': {
          event_id: eventId,
          key: status,
          rel_type: 'm.annotation',
        },
      };
      try {
        await this.sendReactionDeferred?.promise;
        return await this.sendEvent(roomId, 'm.reaction', content);
      } catch (e) {
        throw new Error(
          `Error sending reaction event: ${
            'message' in (e as Error) ? (e as Error).message : e
          }`,
        );
      }
    }

    async sendCommandResultMessage(
      roomId: string,
      eventId: string,
      result: any,
    ) {
      let body = `Command Results from command event ${eventId}`;
      let html = body;
      let content: CommandResultContent = {
        'm.relates_to': {
          event_id: eventId,
          rel_type: 'm.annotation',
          key: 'applied', //this is aggregated key. All annotations must have one. This identifies the reaction event.
        },
        body,
        formatted_body: html,
        msgtype: 'org.boxel.commandResult',
        result,
      };
      try {
        return await this.sendEvent(roomId, 'm.room.message', content);
      } catch (e) {
        throw new Error(
          `Error sending reaction event: ${
            'message' in (e as Error) ? (e as Error).message : e
          }`,
        );
      }
    }

    async sendEvent(roomId: string, eventType: string, content: any) {
      await addRoomEvent(this, {
        event_id: uuid(),
        room_id: roomId,
        type: eventType,
        sender: this.userId,
        origin_server_ts: Date.now(),
        content,
        status: null,
      });
    }

    async sendMessage(
      roomId: string,
      body: string | undefined,
      _cards: CardDef[],
      clientGeneratedId: string,
      _context?: OperatorModeContext,
    ) {
      let event = {
        room_id: roomId,
        state_key: 'state',
        type: 'm.room.message',
        sender: this.userId,
        content: {
          body,
          msgtype: 'org.boxel.message',
          formatted_body: body,
          format: 'org.matrix.custom.html',
        },
        origin_server_ts: Date.now(),
        unsigned: {
          age: 105,
          transaction_id: '1',
        },
        status: null,
        clientGeneratedId,
      };
      await addRoomEvent(this, event);
    }

    async logout() {
      this.client = new MockClient(this as any, undefined);
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
        content: { name: name ?? roomId },
        status: null,
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
        status: null,
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
        status: null,
      });

      await addRoomEvent(this, {
        event_id: 'eventinvite',
        room_id: roomId,
        type: 'm.room.member',
        sender: '@testuser:staging',
        state_key: '@aibot:localhost',
        content: {
          displayname: 'aibot',
          membership: 'invite',
        },
        status: null,
      });

      return roomId;
    }

    getLastActiveTimestamp(roomId: string) {
      let resource = this.roomResources.get(roomId);
      return resource?.lastActiveTimestamp;
    }

    getRoom(roomId: string) {
      return this.rooms.get(roomId);
    }

    setRoom(roomId: string, room: RoomState) {
      this.rooms.set(roomId, room);
      if (!this.roomResourcesCache.has(roomId)) {
        this.roomResourcesCache.set(
          roomId,
          getRoom(
            this,
            () => roomId,
            () => this.getRoom(roomId)?.events,
          ),
        );
      }
    }

    @cached
    get roomResources() {
      let resources: TrackedMap<string, RoomResource> = new TrackedMap();
      for (let roomId of this.rooms.keys()) {
        if (!this.roomResourcesCache.get(roomId)) {
          continue;
        }
        resources.set(roomId, this.roomResourcesCache.get(roomId)!);
      }
      return resources;
    }

    async createCommandField(attr: Record<string, any>): Promise<CommandField> {
      let data: LooseCardResource = {
        meta: {
          adoptsFrom: {
            name: 'CommandField',
            module: `${baseRealm.url}command`,
          },
        },
        attributes: {
          ...attr,
        },
      };
      let card = this.cardAPI.createFromSerialized<typeof CommandField>(
        data,
        { data },
        undefined,
      );
      return card;
    }
  }
  return MockMatrixService;
}

export function setupMatrixServiceMock(
  hooks: NestedHooks,
  // "autostart: true" is recommended for integration tests. Acceptance tests
  // can rely on the real app's start behavior.
  opts: { autostart: boolean } = { autostart: false },
) {
  let realmService: RealmService;
  let currentPermissions: Record<string, ('read' | 'write')[]> = {};
  let currentExpiresInSec: number | undefined;

  hooks.beforeEach(async function () {
    currentPermissions = {};
    currentExpiresInSec = undefined;
    realmService = this.owner.lookup('service:realm') as RealmService;
    // clear any session refresh timers that may bleed into tests
    realmService.logout();
    this.owner.register(
      'service:matrixService',
      generateMockMatrixService(
        () => currentPermissions,
        () => currentExpiresInSec,
      ),
    );
    let matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
    if (opts.autostart) {
      await matrixService.start();
    }
  });

  hooks.afterEach(function () {
    // clear any session refresh timers that may bleed into other tests
    realmService?.logout();
    currentPermissions = {};
    currentExpiresInSec = undefined;
  });

  const setRealmPermissions = (permissions: {
    [realmURL: string]: ('read' | 'write')[];
  }) => {
    currentPermissions = permissions;
    // indexing may have already caused the realm service to establish a
    // session, so when we change permissions we need to re-authenticate. This
    // could stop being a problem if we make the test realm's indexing stay
    // separate from the normal host loader.
    realmService.logout();
  };

  const setExpiresInSec = (expiresInSec: number) => {
    currentExpiresInSec = expiresInSec;
    realmService.logout();
  };

  return { setRealmPermissions, setExpiresInSec };
}
