import window from 'ember-window-mock';

import { ExtendedMatrixSDK } from '@cardstack/host/services/matrix-sdk-loader';

import { createJWT } from './index';

import type * as MatrixSDK from 'matrix-js-sdk';

export interface Options {
  loggedInAs?: string;
  displayName?: string;
  activeRealms?: string[];
}

// When also using setupBaseRealm, this must come before setupBastRealm so it
// can pre-fill the local storage mock before services start initializing.
export function setupMockMatrix(hooks: NestedHooks, opts: Options = {}) {
  hooks.beforeEach(function () {
    let sdk = new MockSDK(opts);
    const { loggedInAs } = opts;
    if (loggedInAs) {
      window.localStorage.setItem(
        'auth',
        JSON.stringify({
          access_token: 'mock-access-token',
          device_id: 'mock-device-id',
          user_id: loggedInAs,
        }),
      );
      window.localStorage.setItem(
        'boxel-session',
        JSON.stringify(
          Object.fromEntries(
            (opts.activeRealms ?? []).map((realmURL) => [
              realmURL,
              createJWT(
                {
                  user: loggedInAs,
                  realm: realmURL,
                  permissions: ['read', 'write'],
                },
                '1h',
                'xxx',
              ),
            ]),
          ),
        ),
      );
    }
    this.owner.register(
      'service:matrixSdkLoader',
      {
        async load() {
          return sdk;
        },
      },
      {
        instantiate: false,
      },
    );
  });
}

class ServerState {
  #roomCounter = 0;
  #eventCounter = 0;
  #rooms: { id: string }[] = [];

  get rooms(): { id: string }[] {
    return this.#rooms;
  }

  createRoom(): string {
    let id = `mock_room_${this.#roomCounter++}`;
    this.#rooms.push({ id });
    return id;
  }

  eventId(): string {
    return `mock_event_${this.#eventCounter++}`;
  }
}

class MockSDK implements ExtendedMatrixSDK {
  private serverState = new ServerState();

  constructor(private sdkOpts: Options) {}

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(
      this,
      this.serverState,
      clientOpts,
      this.sdkOpts,
    ) as unknown as MatrixSDK.MatrixClient;
  }

  RoomEvent = {
    Timeline: 'Room.timeline',
    LocalEchoUpdated: 'Room.localEchoUpdated',
    Receipt: 'Room.receipt',
  } as ExtendedMatrixSDK['RoomEvent'];

  RoomMemberEvent = {
    Membership: 'RoomMember.membership',
  } as ExtendedMatrixSDK['RoomMemberEvent'];

  Preset = {
    PrivateChat: 'private_chat',
    TrustedPrivateChat: 'trusted_private_chat',
    PublicChat: 'public_chat',
  } as ExtendedMatrixSDK['Preset'];

  ClientEvent = {
    AccountData: 'accountData',
  } as ExtendedMatrixSDK['ClientEvent'];
}

class MockClient
  implements
    Pick<
      MatrixSDK.MatrixClient,
      | 'isLoggedIn'
      | 'getUserId'
      | 'getProfileInfo'
      | 'getThreePids'
      | 'createRoom'
      | 'setPowerLevel'
      | 'on'
      | 'off'
      | 'startClient'
      | 'getJoinedRooms'
      | 'decryptEventIfNeeded'
      | 'getRoom'
      | 'sendEvent'
    >
{
  private listeners = new Map();

  constructor(
    private sdk: MockSDK,
    private serverState: ServerState,
    _clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Options,
  ) {}

  async sendEvent(
    roomId: string,
    eventType: string,
    content: MatrixSDK.IContent,
  ): Promise<MatrixSDK.ISendEventResponse> {
    let roomEvent = {
      event_id: this.serverState.eventId(),
      room_id: roomId,
      state_key: 'state',
      type: eventType,
      sender: this.sdkOpts.loggedInAs || 'unknown_user',
      origin_server_ts: Date.now(),
      content,
      status: null,
      unsigned: {
        age: 105,
        transaction_id: '1',
      },
    };
    await this.emitEvent(roomEvent);
    return roomEvent;
  }

  getRoom(roomId: string | undefined): MatrixSDK.Room | null {
    let hit = this.serverState.rooms.find((r) => r.id === roomId);
    if (hit) {
      return {
        getMember(_userId: string) {
          return {
            membership: 'join',
          };
        },
        oldState: {},
      } as MatrixSDK.Room;
    }
    return null;
  }

  async decryptEventIfNeeded(
    _event: MatrixSDK.MatrixEvent,
    _options?: MatrixSDK.IDecryptOptions | undefined,
  ): Promise<void> {}

  async getJoinedRooms(): Promise<{
    joined_rooms: string[];
  }> {
    return {
      joined_rooms: this.serverState.rooms.map((r) => r.id),
    };
  }

  async startClient(
    _opts?: MatrixSDK.IStartClientOpts | undefined,
  ): Promise<void> {
    await this.emitEvent({
      type: 'com.cardstack.boxel.realms',
      content: {
        realms: this.sdkOpts.activeRealms ?? [],
      },
    });
  }

  private eventHandlerType(type: string) {
    switch (type) {
      case 'com.cardstack.boxel.realms':
        return this.sdk.ClientEvent.AccountData;
      case 'm.room.create':
      case 'm.room.message':
        return this.sdk.RoomEvent.Timeline;
      default:
        throw new Error(`unknown type ${type} in mock`);
    }
  }

  private async emitEvent(event: { type: string } & Record<string, unknown>) {
    let handlers = this.listeners.get(this.eventHandlerType(event.type));
    if (handlers) {
      for (let handler of handlers) {
        let result: any = { event };
        result.getContent = function () {
          return this.event.content;
        };
        await handler(result);
      }
    }
  }

  on<T extends MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents>(
    event: T,
    listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    if (!event) {
      throw new Error(`missing event type in matrix mock`);
    }
    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(listener);
    return this as unknown as MatrixSDK.MatrixClient;
  }

  off<T extends MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents>(
    event: T,
    listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    return this as unknown as MatrixSDK.MatrixClient;
  }

  async setPowerLevel(
    roomId: string,
    userId: string | string[],
    powerLevel: number | undefined,
    event?: MatrixSDK.MatrixEvent | null | undefined,
  ): Promise<MatrixSDK.ISendEventResponse> {}

  async createRoom(
    _options: MatrixSDK.ICreateRoomOpts,
  ): Promise<{ room_id: string }> {
    let room_id = this.serverState.createRoom();

    this.emitEvent({
      event_id: this.serverState.eventId(),
      origin_server_ts: new Date().getTime(),
      room_id,
      sender: this.sdkOpts.loggedInAs ?? 'unknown_user',
      state_key: '',
      type: 'm.room.create',
    });

    return { room_id };
  }

  async getThreePids(): Promise<{ threepids: MatrixSDK.IThreepid[] }> {
    return {
      threepids: [
        {
          added_at: 0,
          validated_at: 0,
          address: 'testuser@example.com',
          medium: 'email' as MatrixSDK.ThreepidMedium.Email,
        },
      ],
    };
  }

  async getProfileInfo(
    _userId: string,
    _info?: string | undefined,
  ): Promise<{
    avatar_url?: string | undefined;
    displayname?: string | undefined;
  }> {
    return {
      displayname: this.sdkOpts.displayName ?? 'Mock User',
    };
  }

  isLoggedIn() {
    return Boolean(this.sdkOpts.loggedInAs);
  }

  getUserId(): string | null {
    return this.sdkOpts.loggedInAs ?? null;
  }
}
