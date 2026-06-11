import type Owner from '@ember/owner';

import type { RealmAction } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type RealmService from '@cardstack/host/services/realm';

import type { RealmEvent } from 'https://cardstack.com/base/matrix-event';

import { setupAuthEndpoints } from '../';

import type { MockSDK } from './_sdk';
import type { Config } from '../mock-matrix';

import type * as MatrixSDK from 'matrix-js-sdk';

type IEvent = MatrixSDK.IEvent;

export class MockUtils {
  constructor(
    private testState: { owner?: Owner; sdk?: MockSDK; opts?: Config },
    readonly start: () => Promise<void>,
  ) {}
  getRoomEvents = (roomId: string) => {
    return this.testState.sdk!.getRoomEvents(roomId);
  };
  getRoomIds = () => {
    // A realm can fire a deferred `broadcastRealmEvent` (the trailing `index`
    // event of an indexing run) after the owning test has ended and
    // `setupMockMatrix`'s afterEach has torn the mock SDK down. The test
    // adapter's broadcast path reads room ids through here; without this guard
    // a late broadcast throws `Cannot read properties of undefined (reading
    // 'serverState')` as a QUnit *global failure*, which fails an unrelated
    // sibling test instead of the test that leaked the broadcast. No SDK means
    // there are no rooms to deliver to, so report none.
    if (!this.testState.sdk) {
      return [];
    }
    return this.testState.sdk.serverState.rooms.map((r) => r.id);
  };

  getRoomIdForRealmAndUser = (realmURL: string, userId: string) => {
    return getRoomIdForRealmAndUser(realmURL, userId);
  };

  getRoomState = (roomId: string, eventType: string, stateKey?: string) => {
    return this.testState.sdk!.serverState.getRoomState(
      roomId,
      eventType,
      stateKey,
    );
  };

  getSystemCardAccountData = () => {
    return this.testState.opts?.systemCardAccountData;
  };

  getRealmEventMessagesSince = (roomId: string, since: number) => {
    return this.testState
      .sdk!.serverState.getRoomEvents(roomId)
      .filter(
        (e: IEvent) => isRealmEvent(e) && e.origin_server_ts > since,
      ) as RealmEvent[];
  };

  setRealmPermissions = (permissions: Record<string, RealmAction[]>) => {
    this.testState.opts!.realmPermissions = permissions;
    (this.testState.owner!.lookup('service:realm') as RealmService).logout();

    setupAuthEndpoints(permissions);
  };
  simulateRemoteMessage = (
    roomId: string,
    sender: string,
    content: MatrixSDK.IEvent['content'],
    overrides?: {
      event_id?: string;
      state_key?: string;
      origin_server_ts?: number;
      type?: string;
    },
  ) => {
    return this.testState.sdk!.serverState.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: overrides?.type ?? 'm.room.message',
        content,
      },
      overrides,
    );
  };

  setReadReceipt = (roomId: string, eventId: string, reader: string) => {
    return this.testState.sdk!.serverState.addReceiptEvent(
      roomId,
      eventId,
      reader,
      'm.read' as MatrixSDK.ReceiptType,
    );
  };

  setExpiresInSec = (sec: number) => {
    this.testState.opts!.expiresInSec = sec;
  };
  setActiveRealms = (realmURLs: string[]) => {
    this.testState.opts!.activeRealms = realmURLs;
  };
  createAndJoinRoom = ({
    sender,
    name,
    id,
    timestamp,
  }: {
    sender: string;
    name: string;
    id?: string;
    timestamp?: number;
  }) => {
    let roomId = this.testState.sdk!.serverState.createRoom(
      sender,
      name,
      timestamp,
      id,
    );
    return roomId;
  };
  getUploadedContents = () => {
    return this.testState.sdk!.serverState.getUploadedContents();
  };
  setUploadContentInterceptor = (fn: (() => Promise<void>) | undefined) => {
    this.testState.opts!.uploadContentInterceptor = fn;
  };
  setSendEventInterceptor = (fn: (() => Promise<void>) | undefined) => {
    this.testState.opts!.sendEventInterceptor = fn;
  };

  setRoomState = (
    roomId: string,
    eventType: string,
    content: Record<string, any>,
    stateKey?: string,
  ) => {
    return this.testState.sdk!.serverState.setRoomState(
      this.testState.opts?.loggedInAs || 'unknown_user',
      roomId,
      eventType as string,
      content,
      stateKey,
    );
  };
}

function isRealmEvent(e: IEvent): e is RealmEvent {
  return e.type === APP_BOXEL_REALM_EVENT_TYPE;
}

export function getRoomIdForRealmAndUser(realmURL: string, userId: string) {
  return `test-session-room-realm-${realmURL}-user-${userId}`;
}
