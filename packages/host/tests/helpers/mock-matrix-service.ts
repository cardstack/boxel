import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { cached, tracked } from '@glimmer/tracking';

import { ISendEventResponse } from 'matrix-js-sdk';
import { md5 } from 'super-fast-md5';
import { TrackedMap } from 'tracked-built-ins';

import { v4 as uuid } from 'uuid';

import {
  Deferred,
  loaderFor,
  LooseSingleCardDocument,
  splitStringIntoChunks,
  baseRealm,
  unixTime,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { LooseCardResource } from '@cardstack/runtime-common';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';
import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import { RoomResource, getRoom } from '@cardstack/host/resources/room';
import CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type MatrixService from '@cardstack/host/services/matrix-service';
import { OperatorModeContext } from '@cardstack/host/services/matrix-service';

import RealmService from '@cardstack/host/services/realm';

import type { Base64ImageField as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { BaseDef, CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  CardFragmentContent,
  CommandResultContent,
  ReactionEventContent,
} from 'https://cardstack.com/base/matrix-event';
const waiter = buildWaiter('mock-matrix-service');
const MAX_CARD_SIZE_KB = 60;

let cardApi: typeof import('https://cardstack.com/base/card-api');
let nonce = 0;

export type MockMatrixService = MatrixService & {
  sendReactionDeferred: Deferred<void>; // used to assert applying state in apply button
  cardAPI: typeof cardApi;
  createAndJoinRoom(
    roomId: string,
    roomName: string,
    timestamp?: number,
  ): Promise<string>;
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
    cardHashes: Map<string, string> = new Map(); // hashes <> event id
    currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
      new TrackedMap();

    async start(_auth?: any) {
      await this.loginToRealms();
    }

    private async loginToRealms() {
      // This is where we would actually load user-specific choices out of the
      // user's profile based on this.client.getUserId();
      let activeRealms = this.cardService.unresolvedRealmURLs;

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
      let nowInSeconds = unixTime(Date.now());
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
      return await this.createAndJoinRoom(name, name);
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
      result: Record<string, any>,
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

    async sendEvent(
      roomId: string,
      eventType: string,
      content: any,
    ): Promise<ISendEventResponse> {
      let encodedContent = content;
      if ('data' in content) {
        encodedContent = {
          ...content,
          data: JSON.stringify(content.data),
        };
      }
      let roomEvent = {
        event_id: uuid(),
        room_id: roomId,
        state_key: 'state',
        type: eventType,
        sender: this.userId,
        origin_server_ts: Date.now(),
        content: encodedContent,
        status: null,
        unsigned: {
          age: 105,
          transaction_id: '1',
        },
      };
      await addRoomEvent(this, roomEvent);
      return roomEvent;
    }

    async getCardEventIds(
      cards: CardDef[],
      roomId: string,
      cardHashes: Map<string, string>,
      opts?: CardAPI.SerializeOpts,
    ) {
      if (!cards.length) {
        return [];
      }
      let serializedCards = await Promise.all(
        cards.map(async (card) => {
          let { Base64ImageField } = await loaderFor(card).import<{
            Base64ImageField: typeof Base64ImageFieldType;
          }>(`${baseRealm.url}base64-image`);
          return await this.cardService.serializeCard(card, {
            omitFields: [Base64ImageField],
            ...opts,
          });
        }),
      );

      let eventIds: string[] = [];
      if (serializedCards.length) {
        for (let card of serializedCards) {
          let eventId = cardHashes.get(this.generateCardHashKey(roomId, card));
          if (eventId === undefined) {
            let responses = await this.sendCardFragments(roomId, card);
            eventId = responses[0].event_id; // we only care about the first fragment
            cardHashes.set(this.generateCardHashKey(roomId, card), eventId);
          }
          eventIds.push(eventId);
        }
      }
      return eventIds;
    }

    async sendMessage(
      roomId: string,
      body: string | undefined,
      attachedCards: CardDef[],
      clientGeneratedId: string,
      _context?: OperatorModeContext,
    ) {
      let waiterToken = waiter.beginAsync();
      let attachedCardsEventIds = await this.getCardEventIds(
        attachedCards,
        roomId,
        this.cardHashes,
      );
      let content = {
        body,
        msgtype: 'org.boxel.message',
        formatted_body: body,
        format: 'org.matrix.custom.html',
        clientGeneratedId,
        data: {
          attachedCardsEventIds,
        },
      };
      await this.sendEvent(roomId, 'm.room.message', content);
      waiter.endAsync(waiterToken);
    }

    private async sendCardFragments(
      roomId: string,
      card: LooseSingleCardDocument,
    ): Promise<ISendEventResponse[]> {
      let fragments = splitStringIntoChunks(
        JSON.stringify(card),
        MAX_CARD_SIZE_KB,
      );
      let responses: ISendEventResponse[] = [];
      for (let index = fragments.length - 1; index >= 0; index--) {
        let cardFragment = fragments[index];
        let response = await this.sendEvent(roomId, 'm.room.message', {
          msgtype: 'org.boxel.cardFragment' as const,
          format: 'org.boxel.card' as const,
          body: `card fragment ${index + 1} of ${fragments.length}`,
          formatted_body: `card fragment ${index + 1} of ${fragments.length}`,
          data: {
            ...(index < fragments.length - 1
              ? { nextFragment: responses[0].event_id }
              : {}),
            cardFragment,
            index,
            totalParts: fragments.length,
          },
        } as CardFragmentContent);
        responses.unshift(response);
      }
      return responses;
    }

    generateCardHashKey(roomId: string, card: LooseSingleCardDocument) {
      return md5(roomId + JSON.stringify(card));
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

    async createAndJoinRoom(
      roomId: string,
      name: string,
      timestamp = Date.now(),
    ) {
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
        origin_server_ts: timestamp,
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
        origin_server_ts: timestamp,
        content: {
          displayname: 'testuser',
          membership: 'join',
          membershipTs: timestamp,
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

    async createCard<T extends typeof BaseDef>(
      codeRef: ResolvedCodeRef,
      attr: Record<string, any>,
    ) {
      let data: LooseCardResource = {
        meta: {
          adoptsFrom: codeRef,
        },
        attributes: {
          ...attr,
        },
      };
      let card = await this.cardAPI.createFromSerialized<T>(
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
