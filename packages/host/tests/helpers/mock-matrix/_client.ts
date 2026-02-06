import type Owner from '@ember/owner';

import { getService } from '@universal-ember/test-support';

import { MatrixEvent } from 'matrix-js-sdk';

import * as MatrixSDK from 'matrix-js-sdk';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { baseRealm, unixTime } from '@cardstack/runtime-common';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_LLM_MODE,
  APP_BOXEL_SYSTEM_CARD_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import ENV from '@cardstack/host/config/environment';

import type {
  FileDefManager,
  PrivilegedFileDefManager,
} from '@cardstack/host/lib/file-def-manager';
import FileDefManagerImpl from '@cardstack/host/lib/file-def-manager';
import type { ExtendedClient } from '@cardstack/host/services/matrix-sdk-loader';

import { assertNever } from '@cardstack/host/utils/assert-never';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { BOT_TRIGGER_EVENT_TYPE } from 'https://cardstack.com/base/matrix-event';
import type { CommandField } from 'https://cardstack.com/base/skill';

import type { MockSDK } from './_sdk';

import type { ServerState } from './_server-state';

import type { Config } from '../mock-matrix';
import type {
  MSC3575SlidingSyncRequest,
  MSC3575SlidingSyncResponse,
} from 'matrix-js-sdk/lib/sliding-sync';

type IEvent = MatrixSDK.IEvent;

let nonce = 0;

type Plural<T> = {
  [K in keyof T]: T[K][];
};

const publicRealmURLs = [
  baseRealm.url,
  ensureTrailingSlash(ENV.resolvedCatalogRealmURL),
  ensureTrailingSlash(ENV.resolvedSkillsRealmURL),
];

export class MockClient implements ExtendedClient {
  private listeners: Partial<Plural<MatrixSDK.ClientEventHandlerMap>> = {};

  private txnCtr = 0;
  private fileDefManager: FileDefManager;
  slidingSyncInstance: any;

  constructor(
    private owner: Owner,
    private sdk: MockSDK,
    private serverState: ServerState,
    private clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Config,
  ) {
    let matrixService = getService('matrix-service');
    this.fileDefManager = new FileDefManagerImpl({
      client: this as unknown as ExtendedClient,
      owner: this.owner,
      getCardAPI: () => matrixService.cardAPI,
      getFileAPI: () => matrixService.fileAPI,
    });
  }

  async getAccountDataFromServer<K extends keyof MatrixSDK.AccountDataEvents>(
    _eventType: K,
  ): Promise<MatrixSDK.AccountDataEvents[K] | null> {
    if (_eventType === 'm.direct') {
      return {
        [this.loggedInAs!]: this.sdkOpts.directRooms ?? [],
      } as unknown as K;
    } else if (_eventType === APP_BOXEL_REALMS_EVENT_TYPE) {
      return {
        realms: this.sdkOpts.activeRealms ?? [],
      } as unknown as K;
    } else if (_eventType === APP_BOXEL_SYSTEM_CARD_EVENT_TYPE) {
      return (this.sdkOpts.systemCardAccountData ?? null) as unknown as K;
    }
    return null;
  }

  get loggedInAs() {
    return this.clientOpts.userId ?? this.sdkOpts.loggedInAs;
  }

  async startClient(
    opts?: MatrixSDK.IStartClientOpts | undefined,
  ): Promise<void> {
    if (opts?.slidingSync) {
      this.slidingSyncInstance = opts.slidingSync;
      await opts.slidingSync.start();
    }

    this.serverState.onEvent((serverEvent: IEvent) => {
      this.emitEvent(new MatrixEvent(serverEvent));
    });

    this.serverState.onSlidingSyncEvent((roomId, roomName) => {
      if (this.slidingSyncInstance) {
        this.slidingSyncInstance.triggerRoomSync(
          roomId,
          roomName,
          this.serverState,
        );
      }
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
    let sessionRoom = `test-session-room-realm-${realmURL.href}-user-${this.loggedInAs}`;
    let realmServerURL =
      ensureTrailingSlash(realmURL.href) === baseRealm.url
        ? new URL(ENV.resolvedBaseRealmURL).origin
        : realmURL.origin;
    let payload = {
      iat: nowInSeconds,
      exp: expires,
      user: this.loggedInAs,
      realm: realmURL.href,
      sessionRoom,
      realmServerURL: ensureTrailingSlash(realmServerURL),
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

  downloadContentAsBlob(_file: FileDef): Promise<Blob> {
    throw new Error('Method not implemented.');
  }

  hashMessageWithSecret(_message: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  getAccessToken(): string | null {
    return "shhh! it's a secret";
  }

  async getOpenIdToken() {
    let accessToken =
      this.sdkOpts.loggedInAs ?? this.clientOpts.userId ?? 'mock-matrix-user';
    let baseUrl = this.baseUrl ?? 'http://localhost';
    let matrixServerName: string;
    try {
      matrixServerName = new URL(baseUrl).host;
    } catch (_e) {
      matrixServerName = 'localhost';
    }
    return {
      access_token: `mock-openid-token:${accessToken}`,
      expires_in: this.sdkOpts.expiresInSec ?? 60 * 60,
      matrix_server_name: matrixServerName,
      token_type: 'Bearer',
    };
  }

  setAccountData<K extends keyof MatrixSDK.AccountDataEvents>(
    type: K,
    data: K,
  ): Promise<{}> {
    if (type === APP_BOXEL_REALMS_EVENT_TYPE) {
      this.sdkOpts.activeRealms = (data as any).realms;
    } else if (type === 'm.direct') {
      this.sdkOpts.directRooms = (data as any)[this.loggedInAs!];
    } else if (type === APP_BOXEL_SYSTEM_CARD_EVENT_TYPE) {
      this.sdkOpts.systemCardAccountData = data as any;
    } else {
      throw new Error(
        'Support for updating this event type in account data is not yet implemented in this mock.',
      );
    }
    this.emitEvent(
      new MatrixEvent({
        type: type as string,
        content: data as unknown as Record<string, unknown>,
      }),
    );
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

  paginateEventTimeline(
    _timeline: MatrixSDK.EventTimeline,
    _opts?: MatrixSDK.IPaginateOpts | undefined,
  ): Promise<boolean> {
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
    roomId: string,
    userId: string,
    _reason?: string | undefined,
  ): Promise<{}> {
    let sender =
      this.loggedInAs ?? this.clientOpts.userId ?? '@test_user:localhost';
    let timestamp = Date.now();
    this.serverState.setRoomState(
      sender,
      roomId,
      'm.room.member',
      {
        displayname: userId,
        membership: 'invite',
        membershipTs: timestamp,
        membershipInitiator: sender,
      },
      userId,
      timestamp,
    );
    return Promise.resolve({});
  }

  joinRoom(
    _roomIdOrAlias: string,
    _opts?: MatrixSDK.IJoinRoomOpts | undefined,
  ): Promise<MatrixSDK.Room> {
    let userId =
      this.loggedInAs ?? this.clientOpts.userId ?? '@test_user:localhost';

    this.serverState.setRoomState(
      userId,
      _roomIdOrAlias,
      'm.room.member',
      {
        displayname: userId,
        membership: 'join',
      },
      userId,
    );
    if (this.slidingSyncInstance) {
      setTimeout(() => {
        this.slidingSyncInstance.triggerRoomSync(
          _roomIdOrAlias,
          'A joined room',
          this.serverState,
        );
      }, 0);
    }

    return Promise.resolve({
      roomId: _roomIdOrAlias,
    } as unknown as MatrixSDK.Room);
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

  sendStateEvent<K extends keyof MatrixSDK.StateEvents>(
    roomId: string,
    eventType: K,
    content: MatrixSDK.IContent,
    stateKey?: string | undefined,
    _opts?: MatrixSDK.IRequestOpts | undefined,
  ): Promise<MatrixSDK.ISendEventResponse> {
    let eventId = this.serverState.setRoomState(
      this.loggedInAs || 'unknown_user',
      roomId,
      eventType as string,
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
        roomId,
        client: this,
        myUserId: this.loggedInAs!,
        opts: {},
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
            getEvents: () =>
              this.serverState
                .getRoomEvents(roomId!)
                .map((e) => new MatrixEvent(e)),
          };
        },
        getOrCreateFilteredTimelineSet: (
          filter: MatrixSDK.Filter,
          _opts = {},
        ) => {
          return {
            getLiveTimeline: () => ({
              getEvents: () => [],
              getPaginationToken: () => null,
              setPaginationToken: () => {},
              getNeighbouringTimeline: () => null,
            }),
            addLiveEvent: () => {},
            getTimelines: () => [],
            getFilter: () => filter,
            setFilter: () => {},
            getTimelineForEvent: () => null,
            addTimeline: () => ({
              getEvents: () => [],
              getPaginationToken: () => null,
              setPaginationToken: () => {},
              getNeighbouringTimeline: () => null,
            }),
            addEventsToTimeline: () => {},
            handleRemoteEcho: () => {},
            canContain: () => true,
          };
        },
      } as unknown as MatrixSDK.Room;
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
      case APP_BOXEL_SYSTEM_CARD_EVENT_TYPE:
      case 'm.direct':
        return this.sdk.ClientEvent.AccountData;
      case APP_BOXEL_ROOM_SKILLS_EVENT_TYPE:
      case APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE:
      case APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
      case APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE:
      case APP_BOXEL_ACTIVE_LLM:
      case APP_BOXEL_REALM_EVENT_TYPE:
      case BOT_TRIGGER_EVENT_TYPE:
      case 'm.room.create':
      case 'm.room.message':
      case 'm.room.name':
      case 'm.room.member':
      case APP_BOXEL_LLM_MODE:
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
    initial_state,
  }: MatrixSDK.ICreateRoomOpts): Promise<{ room_id: string }> {
    let sender = this.loggedInAs || 'unknown_user';
    let roomId = this.serverState.createRoom(sender, name);

    if (initial_state) {
      for (let event of initial_state) {
        this.serverState.setRoomState(
          sender,
          roomId,
          event.type,
          event.content,
        );
      }
    }

    if (this.slidingSyncInstance) {
      setTimeout(() => {
        this.slidingSyncInstance.triggerRoomSync(
          roomId,
          name,
          this.serverState,
        );
      }, 0);
    }

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

  async uploadCards(cards: CardDef[]): Promise<FileDef[]> {
    return await this.fileDefManager.uploadCards(cards);
  }

  async uploadCommandDefinitions(
    commandDefinitions: CommandField[],
  ): Promise<FileDef[]> {
    return await this.fileDefManager.uploadCommandDefinitions(
      commandDefinitions,
    );
  }

  async uploadFiles(files: FileDef[]): Promise<FileDef[]> {
    return await this.fileDefManager.uploadFiles(files);
  }

  async cacheContentHashIfNeeded(event: DiscreteMatrixEvent): Promise<void> {
    this.fileDefManager.cacheContentHashIfNeeded(event);
  }

  async recacheContentHash(contentHash: string, url: string): Promise<void> {
    const fileDefManager = this.fileDefManager as PrivilegedFileDefManager;
    if (fileDefManager.invalidUrlCache.has(url)) {
      // Skipping re-caching for this url as it was previously checked and is invalid
      return;
    }

    // Update the cache with the new URL for the content hash
    fileDefManager.contentHashCache.set(contentHash, url);

    let contentArrayBuffer = this.serverState.getContent(url);
    let content = contentArrayBuffer?.toString();
    if (!content) {
      throw new Error('No content found for URL: ' + url);
    }
    const fetchedContentHash = await fileDefManager.getContentHash(content);
    if (fetchedContentHash !== contentHash) {
      console.warn(
        `Content hash mismatch for URL: ${url}, skipping re-caching step`,
      );
      fileDefManager.invalidUrlCache.add(url);
      return;
    }

    // Update the cache with the new URL for the content hash
    fileDefManager.contentHashCache.set(contentHash, url);
  }

  async uploadContent(
    _content: string,
    _opts?: { type?: string; name?: string },
  ): Promise<any> {
    let contentUri = `mxc://mock-server/${Math.random()}`;
    this.serverState.addContent(
      this.mxcUrlToHttp(contentUri),
      _content as unknown as ArrayBuffer,
    );
    return { content_uri: contentUri };
  }

  async downloadCardFileDef(
    serializedFile: SerializedFile,
  ): Promise<LooseSingleCardDocument> {
    let content = this.serverState.getContent(serializedFile.url);
    if (!content) {
      throw new Error(`content not found for ${serializedFile.url}`);
    }
    return JSON.parse(content.toString()) as LooseSingleCardDocument;
  }

  async downloadAsFileInBrowser(
    _serializedFile: SerializedFile,
  ): Promise<void> {
    throw new Error('Method not implemented: downloadAsFileInBrowser');
  }

  mxcUrlToHttp(mxcUrl: string): string {
    return mxcUrl.replace('mxc://', 'http://mock-server/');
  }

  async slidingSync(
    req: MSC3575SlidingSyncRequest,
    _proxyBaseUrl: string,
    _signal: AbortSignal,
  ): Promise<MSC3575SlidingSyncResponse> {
    let lists: MSC3575SlidingSyncResponse['lists'] = {};
    let rooms: MSC3575SlidingSyncResponse['rooms'] = {};
    for (const [listKey, list] of Object.entries(req.lists || {})) {
      for (let i = 0; i < list.ranges.length; i++) {
        let [start, end] = list.ranges[i];
        //currently we only filter rooms using is_dm
        let dmRooms = (await this.getAccountDataFromServer('m.direct')) ?? {};
        let roomsInRange = this.serverState.rooms
          .filter((r) =>
            list.filters?.is_dm
              ? dmRooms[this.loggedInAs!]?.includes(r.id)
              : !dmRooms[this.loggedInAs!]?.includes(r.id),
          )
          .slice(start, end + 1);

        for (let j = 0; j < roomsInRange.length; j++) {
          let room = roomsInRange[j];
          let timeline = this.serverState.getRoomEvents(room.id);
          rooms[room.id] = {
            name:
              this.serverState.getRoomState(room.id, 'm.room.name', '')?.content
                ?.name ?? 'room',
            required_state: [],
            timeline,
            notification_count: 0,
            highlight_count: 0,
            joined_count: 1,
            invited_count: 0,
            initial: true,
          };
          for (let k = 0; k < timeline.length; k++) {
            let event = timeline[k];
            this.emitEvent(new MatrixEvent(event));
          }
        }

        lists[listKey] = {
          count: roomsInRange.length,
          ops: [
            {
              op: 'SYNC',
              room_ids: roomsInRange.map((r) => r.id),
            },
          ],
        };
      }
    }

    let response: MSC3575SlidingSyncResponse = {
      pos: String(Date.now()),
      lists,
      rooms,
      extensions: {},
    };

    return Promise.resolve(response);
  }

  getDeviceId(): string | null {
    return null;
  }

  getDevice(deviceId: string): Promise<MatrixSDK.IMyDevice> {
    throw new Error(`Method not implemented: getDevice ${deviceId}`);
  }
}
