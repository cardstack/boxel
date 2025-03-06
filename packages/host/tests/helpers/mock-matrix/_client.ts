import { MatrixEvent } from 'matrix-js-sdk';

import * as MatrixSDK from 'matrix-js-sdk';

import { baseRealm, unixTime } from '@cardstack/runtime-common';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type { ExtendedClient } from '@cardstack/host/services/matrix-sdk-loader';

import { assertNever } from '@cardstack/host/utils/assert-never';

import { MockSDK } from './_sdk';

import { ServerState } from './_server-state';

import type { Config } from '../mock-matrix';

type IEvent = MatrixSDK.IEvent;

let nonce = 0;

type Plural<T> = {
  [K in keyof T]: T[K][];
};

const publicRealmURLs = [baseRealm.url, 'http://localhost:4201/catalog/'];

export class MockClient implements ExtendedClient {
  private listeners: Partial<Plural<MatrixSDK.ClientEventHandlerMap>> = {};

  private txnCtr = 0;

  constructor(
    private sdk: MockSDK,
    private serverState: ServerState,
    private clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Config,
  ) {}

  async getAccountDataFromServer<T extends { [k: string]: any }>(
    _eventType: string,
  ): Promise<T | null> {
    return {
      realms: this.sdkOpts.activeRealms ?? [],
    } as unknown as T;
  }

  get loggedInAs() {
    return this.clientOpts.userId;
  }

  async startClient(
    _opts?: MatrixSDK.IStartClientOpts | undefined,
  ): Promise<void> {
    this.serverState.onEvent((serverEvent: IEvent) => {
      this.emitEvent(new MatrixEvent(serverEvent));
    });

    this.emitEvent(
      new MatrixEvent({
        type: APP_BOXEL_REALMS_EVENT_TYPE,
        content: {
          realms: this.sdkOpts.activeRealms ?? [],
        },
      }),
    );
  }

  async createRealmSession(realmURL: URL): Promise<string> {
    let secret = "shhh! it's a secret";
    let nowInSeconds = unixTime(Date.now());
    let expires = nowInSeconds + (this.sdkOpts.expiresInSec ?? 60 * 60);
    let header = { alg: 'none', typ: 'JWT' };
    let permissions = (this.sdkOpts.realmPermissions ?? {})[realmURL.href] ?? [
      'read',
      'write',
    ];
    if (publicRealmURLs.includes(realmURL.href)) {
      permissions = ['read'];
    }
    let payload = {
      iat: nowInSeconds,
      exp: expires,
      user: this.loggedInAs,
      realm: realmURL.href,
      sessionRoom: `test-session-room-realm-${realmURL.href}-user-${this.loggedInAs}`,
      // adding a nonce to the test token so that we can tell the difference
      // between different tokens created in the same second
      nonce: nonce++,
      permissions,
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

  hashMessageWithSecret(_message: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  getAccessToken(): string | null {
    throw new Error('Method not implemented.');
  }

  setAccountData<T>(type: string, data: T): Promise<{}> {
    if (type === APP_BOXEL_REALMS_EVENT_TYPE) {
      this.sdkOpts.activeRealms = (data as any).realms;
    } else {
      throw new Error(
        'Support for updating this event type in account data is not yet implemented in this mock.',
      );
    }
    return Promise.resolve({});
  }

  getAccountData<T>(_type: string): Promise<T> {
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
    this.clientOpts.userId = undefined;
    return Promise.resolve({});
  }

  roomState(_roomId: string): Promise<MatrixSDK.IStateEventWithRoomId[]> {
    throw new Error('Method not implemented.');
  }

  setDisplayName(name: string): Promise<{}> {
    this.serverState.setDisplayName(name);
    return Promise.resolve({});
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
    // Local Echo
    let txnId = this.makeTxnId();
    let localEventId = '~' + roomId + ':' + txnId;
    let localEventData = {
      ...roomEvent,
      event_id: localEventId,
      origin_server_ts: (this.sdkOpts.now ?? Date.now)(),
      unsigned: { age: 0 },
      sender: this.loggedInAs || 'unknown_user',
      user_id: this.loggedInAs || 'unknown_user',
      state_key: roomEvent.type === 'm.room.member' ? this.loggedInAs! : '',
    };
    let localEvent = new MatrixEvent(localEventData);
    localEvent.setStatus('sending' as MatrixSDK.EventStatus.SENDING);
    this.emitEvent(localEvent);
    if (content.body?.match(/SENDING_DELAY_THEN_/)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (content.body?.match(/SENDING_DELAY_THEN_FAILURE/)) {
      console.log(
        'SENDING_DELAY_THEN_FAILURE, setting status to NOT_SENT',
        localEvent,
      );
      localEvent.setStatus(MatrixSDK.EventStatus.NOT_SENT);
      this.emitLocalEchoUpdated(localEvent);
      throw new Error('Failed to send event, deliberately');
    }
    let eventId = this.serverState.addRoomEvent(
      this.loggedInAs || 'unknown_user',
      roomEvent,
    );
    let matrixEvent = new MatrixEvent({
      ...localEventData,
      event_id: eventId,
    });

    this.emitLocalEchoUpdated(matrixEvent, localEventId);
    return { event_id: eventId };
  }

  getStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
  ): Promise<Record<string, any>> {
    return Promise.resolve(
      this.serverState.getRoomState(roomId, eventType, stateKey),
    );
  }

  sendStateEvent(
    roomId: string,
    eventType: string,
    content: MatrixSDK.IContent,
    stateKey?: string | undefined,
    _opts?: MatrixSDK.IRequestOpts | undefined,
  ): Promise<MatrixSDK.ISendEventResponse> {
    let eventId = this.serverState.setRoomState(
      this.loggedInAs || 'unknown_user',
      roomId,
      eventType,
      content,
      stateKey,
    );
    return Promise.resolve({ event_id: eventId });
  }

  makeTxnId(): string {
    return 'm.mock.' + this.txnCtr++;
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
        getLastActiveTimestamp: () =>
          this.serverState.getRoomEvents(roomId!).at(-1)?.origin_server_ts ?? 0,
        getLiveTimeline: () => {
          return {
            getState: (_direction: MatrixSDK.Direction) =>
              this.serverState.getRoomStateUpdatePayload(roomId!),
          };
        },
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

  private eventHandlerType(type: string) {
    switch (type) {
      case APP_BOXEL_REALMS_EVENT_TYPE:
        return this.sdk.ClientEvent.AccountData;
      case APP_BOXEL_ROOM_SKILLS_EVENT_TYPE:
      case APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
      case APP_BOXEL_ACTIVE_LLM:
      case APP_BOXEL_REALM_EVENT_TYPE:
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

  private emitEvent(event: MatrixEvent) {
    let eventType = this.eventHandlerType(event.event.type!);
    switch (eventType) {
      case this.sdk.RoomEvent.Timeline:
        {
          let handlers = this.listeners[eventType];

          if (handlers) {
            for (let handler of handlers) {
              handler(event, undefined, undefined, false, {
                fake: 'event-timeline ',
              } as any);
            }
          }
          if (typeof event.event.state_key === 'string') {
            let handlers = this.listeners[this.sdk.RoomStateEvent.Update];
            if (handlers) {
              let roomState = this.serverState.getRoomStateUpdatePayload(
                event.event.room_id!,
              );
              for (let handler of handlers) {
                handler(roomState);
              }
            }
          }
        }
        break;
      case this.sdk.RoomEvent.Receipt:
        {
          let handlers = this.listeners[eventType];

          if (handlers) {
            for (let handler of handlers) {
              handler(event, { fake: 'room ' } as any);
            }
          }
        }
        break;
      case this.sdk.ClientEvent.AccountData:
        {
          let handlers = this.listeners[eventType];

          if (handlers) {
            for (let handler of handlers) {
              handler(event, undefined);
            }
          }
        }
        break;
      case null:
        break;
      default:
        throw assertNever(eventType);
    }
  }

  private emitLocalEchoUpdated(event: MatrixEvent, oldEventId?: string) {
    let handlers = this.listeners[this.sdk.RoomEvent.LocalEchoUpdated];
    if (handlers) {
      for (let handler of handlers) {
        handler(event, { fake: 'room' } as any, oldEventId, undefined);
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
    // @ts-expect-error haven't got the types right yet
    let list = this.listeners[event];
    if (!list) {
      list = [];
      // @ts-expect-error haven't got the types right yet
      this.listeners[event] = list;
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

  async uploadContent(
    _content: ArrayBuffer,
    _opts?: { type?: string; name?: string },
  ): Promise<{ content_uri: string }> {
    return { content_uri: `mxc://mock-server/${Math.random()}` };
  }

  mxcUrlToHttp(mxcUrl: string): string {
    return mxcUrl.replace('mxc://', 'http://mock-server/');
  }
}
