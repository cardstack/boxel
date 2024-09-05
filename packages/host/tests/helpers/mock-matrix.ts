import Owner from '@ember/owner';

import window from 'ember-window-mock';

import { unixTime } from '@cardstack/runtime-common';

import type {
  ExtendedClient,
  ExtendedMatrixSDK,
  MessageOptions,
} from '@cardstack/host/services/matrix-sdk-loader';

import RealmService from '@cardstack/host/services/realm';

import { MatrixEvent } from 'https://cardstack.com/base/matrix-event';

import type * as MatrixSDK from 'matrix-js-sdk';

export interface Config {
  loggedInAs?: string;
  displayName?: string;
  activeRealms?: string[];
  realmPermissions?: Record<string, string[]>;
  expiresInSec?: number;
}

class MockUtils {
  constructor(
    private opts: Config,
    private owner: Owner[],
  ) {}
  setRealmPermissions = (permissions: Record<string, string[]>) => {
    this.opts.realmPermissions = permissions;
    (this.owner[0].lookup('service:realm') as RealmService).logout();
  };
  setExpiresInSec = (sec: number) => {
    this.opts.expiresInSec = sec;
  };
}

// When also using setupBaseRealm, this must come before setupBastRealm so it
// can pre-fill the local storage mock before services start initializing.
export function setupMockMatrix(
  hooks: NestedHooks,
  opts: Config = {},
): MockUtils {
  let ownerContainer: Owner[] = [];
  hooks.beforeEach(function () {
    ownerContainer[0] = this.owner;
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
  return new MockUtils(opts, ownerContainer);
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

// without this, using a class as an interface forces you to have the same
// private and protected methods too
type PublicAPI<T> = { [K in keyof T]: T[K] };

class MockSDK implements PublicAPI<ExtendedMatrixSDK> {
  private serverState = new ServerState();

  constructor(private sdkOpts: Config) {}

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(this, this.serverState, clientOpts, this.sdkOpts);
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

let nonce = 0;

class MockClient implements ExtendedClient {
  private listeners = new Map();

  constructor(
    private sdk: MockSDK,
    private serverState: ServerState,
    private clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Config,
  ) {}

  async createRealmSession(realmURL: URL): Promise<string> {
    let secret = "shhh! it's a secret";
    let nowInSeconds = unixTime(Date.now());
    let expires = nowInSeconds + (this.sdkOpts.expiresInSec ?? 60 * 60);
    let header = { alg: 'none', typ: 'JWT' };
    let payload = {
      iat: nowInSeconds,
      exp: expires,
      user: this.sdkOpts.loggedInAs,
      realm: realmURL.href,
      // adding a nonce to the test token so that we can tell the difference
      // between different tokens created in the same second
      nonce: nonce++,
      permissions: (this.sdkOpts.realmPermissions ?? {})[realmURL.href] ?? [
        'read',
        'write',
      ],
    };
    let stringifiedHeader = JSON.stringify(header);
    let stringifiedPayload = JSON.stringify(payload);
    let headerAndPayload = `${btoa(stringifiedHeader)}.${btoa(
      stringifiedPayload,
    )}`;
    // this is our silly JWT--we don't sign with crypto since we are running in the
    // browser so the secret is the signature
    return `${headerAndPayload}.${secret}`;
  }

  get baseUrl(): string {
    return this.clientOpts.baseUrl;
  }

  getAccessToken(): string | null {
    throw new Error('Method not implemented.');
  }

  addThreePidOnly(_data: MatrixSDK.IAddThreePidOnlyBody): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  get credentials(): { userId: string | null } {
    throw new Error('Method not implemented.');
  }

  deleteThreePid(
    _medium: string,
    _address: string,
  ): Promise<{ id_server_unbind_result: MatrixSDK.IdServerUnbindResult }> {
    throw new Error('Method not implemented.');
  }

  fetchRoomEvent(
    _roomId: string,
    _eventId: string,
  ): Promise<Partial<MatrixSDK.IEvent>> {
    throw new Error('Method not implemented.');
  }

  forget(_roomId: string, _deleteRoom?: boolean | undefined): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  isUsernameAvailable(_username: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  leave(_roomId: string): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  registerRequest(
    _data: MatrixSDK.RegisterRequest,
    _kind?: string | undefined,
  ): Promise<MatrixSDK.RegisterResponse> {
    throw new Error('Method not implemented.');
  }

  requestPasswordEmailToken(
    _email: string,
    _clientSecret: string,
    _sendAttempt: number,
    _nextLink?: string | undefined,
  ): Promise<MatrixSDK.IRequestTokenResponse> {
    throw new Error('Method not implemented.');
  }

  scrollback(
    _room: MatrixSDK.Room,
    _limit?: number | undefined,
  ): Promise<MatrixSDK.Room> {
    throw new Error('Method not implemented.');
  }

  sendReadReceipt(
    _event: MatrixSDK.MatrixEvent | null,
    _receiptType?: MatrixSDK.ReceiptType | undefined,
    _unthreaded?: boolean | undefined,
  ): Promise<{} | undefined> {
    throw new Error('Method not implemented.');
  }

  setPassword(
    _authDict: MatrixSDK.AuthDict,
    _newPassword: string,
    _logoutDevices?: boolean | undefined,
  ): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  setRoomName(
    _roomId: string,
    _name: string,
  ): Promise<MatrixSDK.ISendEventResponse> {
    throw new Error('Method not implemented.');
  }

  invite(
    _roomId: string,
    _userId: string,
    _reason?: string | undefined,
  ): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  joinRoom(
    _roomIdOrAlias: string,
    _opts?: MatrixSDK.IJoinRoomOpts | undefined,
  ): Promise<MatrixSDK.Room> {
    throw new Error('Method not implemented.');
  }

  loginWithPassword(
    _user: string,
    _password: string,
  ): Promise<MatrixSDK.LoginResponse> {
    throw new Error('Method not implemented.');
  }

  logout(_stopClient?: boolean | undefined): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  roomState(_roomId: string): Promise<MatrixSDK.IStateEventWithRoomId[]> {
    throw new Error('Method not implemented.');
  }

  setDisplayName(_name: string): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  allRoomMessages(
    _roomId: string,
    _opts?: MessageOptions | undefined,
  ): Promise<MatrixEvent[]> {
    throw new Error('Method not implemented.');
  }

  requestEmailToken(
    _type: 'registration' | 'threepid',
    _email: string,
    _clientSecret: string,
    _sendAttempt: number,
  ): Promise<MatrixSDK.IRequestTokenResponse> {
    throw new Error('Method not implemented.');
  }

  loginWithEmail(
    _email: string,
    _password: string,
  ): Promise<MatrixSDK.LoginResponse> {
    throw new Error('Method not implemented.');
  }

  sendEvent(
    roomId: string,
    eventType: string,
    content: MatrixSDK.IContent,
    txnId?: string,
  ): Promise<MatrixSDK.ISendEventResponse>;
  sendEvent(
    roomId: string,
    threadId: string | null,
    eventType: string,
    content: MatrixSDK.IContent,
    txnId?: string,
  ): Promise<MatrixSDK.ISendEventResponse>;
  async sendEvent(...args: any[]): Promise<MatrixSDK.ISendEventResponse> {
    let roomId: string;

    let eventType: string;
    let content: MatrixSDK.IContent;

    if (typeof args[2] === 'object') {
      [roomId, eventType, content] = args;
    } else {
      [roomId, , eventType, content] = args;
    }

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
    _event: T,
    _listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    return this as unknown as MatrixSDK.MatrixClient;
  }

  async setPowerLevel(
    _roomId: string,
    _userId: string | string[],
    _powerLevel: number | undefined,
    _event?: MatrixSDK.MatrixEvent | null | undefined,
  ): Promise<MatrixSDK.ISendEventResponse> {
    return { event_id: this.serverState.eventId() };
  }

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
