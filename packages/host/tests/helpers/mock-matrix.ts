import Owner from '@ember/owner';

import window from 'ember-window-mock';

import { unixTime } from '@cardstack/runtime-common';

import type {
  ExtendedClient,
  ExtendedMatrixSDK,
  MessageOptions,
} from '@cardstack/host/services/matrix-sdk-loader';

import type MatrixService from '@cardstack/host/services/matrix-service';
import RealmService from '@cardstack/host/services/realm';

import { MatrixEvent } from 'https://cardstack.com/base/matrix-event';

import type * as MatrixSDK from 'matrix-js-sdk';

export interface Config {
  loggedInAs?: string;
  displayName?: string;
  activeRealms?: string[];
  realmPermissions?: Record<string, string[]>;
  expiresInSec?: number;
  autostart?: boolean;
}

class MockUtils {
  constructor(
    private opts: Config,
    private testState: { owner?: Owner; sdk?: MockSDK },
  ) {}
  getRoomEvents = (roomId: string) => {
    return this.testState.sdk!.getRoomEvents(roomId);
  };
  setRealmPermissions = (permissions: Record<string, string[]>) => {
    this.opts.realmPermissions = permissions;
    (this.testState.owner!.lookup('service:realm') as RealmService).logout();
  };
  simulateRemoteMessage = (
    roomId: string,
    sender: string,
    content: {
      msgtype: string;
      body: string;
      formatted_body: string;
      data: any;
      'm.relates_to': { rel_type: string; event_id: string };
    },
  ) => {
    this.testState.sdk!.serverState.addRoomEvent(sender, {
      room_id: roomId,
      type: 'm.room.message',
      content,
    });
  };
  setExpiresInSec = (sec: number) => {
    this.opts.expiresInSec = sec;
  };
  setActiveRealms = (realmURLs: string[]) => {
    this.opts.activeRealms = realmURLs;
  };
}

export function setupMockMatrix(
  hooks: NestedHooks,
  opts: Config = {},
): MockUtils {
  let testState: { owner?: Owner; sdk?: MockSDK } = {
    owner: undefined,
    sdk: undefined,
  };
  hooks.beforeEach(async function () {
    testState.owner = this.owner;
    let sdk = new MockSDK(opts);
    testState.sdk = sdk;
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
    if (opts.autostart) {
      let matrixService = this.owner.lookup(
        'service:matrix-service',
      ) as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    }
  });
  return new MockUtils(opts, testState);
}

class ServerState {
  #roomCounter = 0;
  #eventCounter = 0;
  #rooms: Map<string, { events: MatrixEvent[]; receipts: MatrixEvent[] }> =
    new Map();
  #listeners: ((event: MatrixEvent) => void)[] = [];
  #displayName: string;

  constructor(opts: { displayName: string }) {
    this.#displayName = opts.displayName;
  }

  get displayName() {
    return this.#displayName;
  }

  onEvent(callback: (event: MatrixEvent) => void) {
    this.addListener(callback);
  }

  get rooms(): { id: string }[] {
    return Array.from(this.#rooms.keys()).map((id) => ({ id }));
  }

  addListener(callback: (event: MatrixEvent) => void) {
    this.#listeners.push(callback);
  }

  createRoom(sender: string, name?: string): string {
    let roomId = `mock_room_${this.#roomCounter++}`;

    if (this.#rooms.has(roomId)) {
      throw new Error(`room ${roomId} already exists`);
    }

    this.#rooms.set(roomId, { events: [], receipts: [] });

    let timestamp = Date.now();

    this.addRoomEvent(sender, {
      room_id: roomId,
      type: 'm.room.create',
      content: {
        creator: sender,
        room_version: '0',
      },
    });

    this.addRoomEvent(sender, {
      room_id: roomId,
      type: 'm.room.name',
      content: { name: name ?? roomId },
    });

    this.addRoomEvent(sender, {
      room_id: roomId,
      type: 'm.room.member',
      content: {
        displayname: 'testuser',
        membership: 'join',
        membershipTs: timestamp,
        membershipInitiator: sender,
      },
    });

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.member',
        content: {
          displayname: 'aibot',
          membership: 'invite',
        },
      },
      // host application expects this for the bot to join the room
      {
        state_key: '@aibot:localhost',
      },
    );

    return roomId;
  }

  addRoomEvent(
    sender: string,
    event: Omit<
      MatrixEvent,
      'event_id' | 'origin_server_ts' | 'unsigned' | 'status' | 'sender'
    >,
    overrides?: { state_key?: string },
  ) {
    let room = this.#rooms.get(event.room_id);
    if (!room) {
      throw new Error(`room ${event.room_id} does not exist`);
    }
    let matrixEvent: MatrixEvent = {
      ...event,
      // Don’t want to list out all the types from MatrixEvent union type
      type: event.type as any,
      event_id: this.eventId(),
      origin_server_ts: Date.now(),
      unsigned: { age: 0 },
      sender,
      status: 'sent' as MatrixSDK.EventStatus.SENT,
      state_key: overrides?.state_key ?? sender,
    };

    room.events.push(matrixEvent);
    this.#listeners.forEach((listener) => listener(matrixEvent));

    return matrixEvent;
  }

  addReactionEvent(
    sender: string,
    roomId: string,
    eventId: string,
    status: string,
  ) {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }

    let content = {
      'm.relates_to': {
        event_id: eventId,
        key: status,
        rel_type: 'm.annotation' as MatrixSDK.RelationType.Annotation,
      },
    };

    let reactionEvent = {
      event_id: this.eventId(),
      origin_server_ts: Date.now(),
      room_id: roomId,
      type: 'm.reaction' as MatrixSDK.EventType.Reaction,
      sender,
      content,
      state_key: '',
      unsigned: { age: 0 },
      status: 'sent' as MatrixSDK.EventStatus.SENT,
    };

    room.events.push(reactionEvent);
    this.#listeners.forEach((listener) => listener(reactionEvent));

    return reactionEvent;
  }

  addReceiptEvent(
    roomId: string,
    eventId: string,
    sender: string,
    receiptType: MatrixSDK.ReceiptType,
  ) {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }

    let content: Record<string, any> = {
      [eventId]: {
        [receiptType]: {
          [sender]: {
            thread_id: 'main',
            ts: Date.now(),
          },
        },
      },
    };

    let receiptEvent: MatrixEvent = {
      event_id: this.eventId(),
      origin_server_ts: Date.now(),
      room_id: roomId,
      type: 'm.receipt' as any,
      sender,
      unsigned: { age: 0 },
      state_key: '',
      status: 'sent' as MatrixSDK.EventStatus.SENT,
      content,
    };

    room.receipts.push(receiptEvent);
    this.#listeners.forEach((listener) => listener(receiptEvent));

    return receiptEvent;
  }

  getRoomEvents(roomId: string): MatrixEvent[] {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }
    return room.events;
  }

  eventId(): string {
    return `mock_event_${this.#eventCounter++}`;
  }

  setDisplayName(name: string) {
    if (name === 'MAKEMECRASH') {
      throw new Error('BOOM!');
    } else {
      this.#displayName = name;
    }
  }
}

// without this, using a class as an interface forces you to have the same
// private and protected methods too
type PublicAPI<T> = { [K in keyof T]: T[K] };

class MockSDK implements PublicAPI<ExtendedMatrixSDK> {
  serverState: ServerState;

  constructor(private sdkOpts: Config) {
    this.serverState = new ServerState({
      displayName: sdkOpts.displayName ?? '',
    });
  }

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(this, this.serverState, clientOpts, this.sdkOpts);
  }

  getRoomEvents(roomId: string) {
    return this.serverState.getRoomEvents(roomId);
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

  get loggedInAs() {
    return this.clientOpts.userId;
  }

  async createRealmSession(realmURL: URL): Promise<string> {
    let secret = "shhh! it's a secret";
    let nowInSeconds = unixTime(Date.now());
    let expires = nowInSeconds + (this.sdkOpts.expiresInSec ?? 60 * 60);
    let header = { alg: 'none', typ: 'JWT' };
    let payload = {
      iat: nowInSeconds,
      exp: expires,
      user: this.loggedInAs,
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
    return { userId: this.loggedInAs ?? null };
  }

  deleteThreePid(
    _medium: string,
    _address: string,
  ): Promise<{ id_server_unbind_result: MatrixSDK.IdServerUnbindResult }> {
    throw new Error('Method not implemented.');
  }

  fetchRoomEvent(
    roomId: string,
    eventId: string,
  ): Promise<Partial<MatrixSDK.IEvent>> {
    let events = this.serverState.getRoomEvents(roomId);
    let event = events.find((e) => e.event_id === eventId);

    if (!event) {
      throw new Error(`event ${eventId} not found in room ${roomId}`);
    }
    return Promise.resolve(event);
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

  async sendReadReceipt(
    event: MatrixSDK.MatrixEvent | null,
    receiptType?: MatrixSDK.ReceiptType | undefined,
    _unthreaded?: boolean | undefined,
  ): Promise<{} | undefined> {
    if (!event) return;
    const eventId = event.getId()!;

    this.serverState.addReceiptEvent(
      event.getRoomId()!,
      eventId,
      this.loggedInAs!,
      receiptType ?? ('m.read' as MatrixSDK.ReceiptType),
    );

    return Promise.resolve({});
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
    this.loggedInAs = undefined;
    return Promise.resolve({});
  }

  roomState(_roomId: string): Promise<MatrixSDK.IStateEventWithRoomId[]> {
    throw new Error('Method not implemented.');
  }

  setDisplayName(name: string): Promise<{}> {
    this.serverState.setDisplayName(name);
    return Promise.resolve({});
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

    let eventType: any;
    let content: MatrixSDK.IContent;

    if (typeof args[2] === 'object') {
      [roomId, eventType, content] = args;
    } else {
      [roomId, , eventType, content] = args;
    }

    let roomEvent = {
      room_id: roomId,
      type: eventType,
      content,
      status: null,
    };
    let matrixEvent = this.serverState.addRoomEvent(
      this.loggedInAs || 'unknown_user',
      roomEvent,
    );
    return matrixEvent;
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
        getLastActiveTimestamp: () => Date.now(),
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
    this.serverState.onEvent(this.emitEvent.bind(this));

    await this.emitEvent({
      // This is not an event type in our MatrixEvent union
      type: 'com.cardstack.boxel.realms',
      content: {
        realms: this.sdkOpts.activeRealms ?? [],
      },
    } as unknown as MatrixEvent);
  }

  private eventHandlerType(type: string) {
    switch (type) {
      case 'com.cardstack.boxel.realms':
        return this.sdk.ClientEvent.AccountData;
      case 'm.reaction':
      case 'm.room.create':
      case 'm.room.message':
      case 'm.room.name':
      case 'm.room.member':
        return this.sdk.RoomEvent.Timeline;
      case 'm.receipt':
        return this.sdk.RoomEvent.Receipt;

      default:
        throw new Error(`unknown type ${type} in mock`);
    }
  }

  private async emitEvent(event: MatrixEvent) {
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

  async createRoom({
    name,
  }: MatrixSDK.ICreateRoomOpts): Promise<{ room_id: string }> {
    let sender = this.loggedInAs || 'unknown_user';
    let roomId = this.serverState.createRoom(sender, name);

    return { room_id: roomId };
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
      displayname: this.serverState.displayName,
    };
  }

  isLoggedIn() {
    return Boolean(this.loggedInAs);
  }

  getUserId(): string | null {
    return this.loggedInAs ?? null;
  }
}
