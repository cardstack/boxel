import Owner from '@ember/owner';

import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import RealmService from '@cardstack/host/services/realm';

import type { RealmEvent } from 'https://cardstack.com/base/matrix-event';

import type { MockSDK } from './_sdk';
import type { Config } from '../mock-matrix';

import type * as MatrixSDK from 'matrix-js-sdk';

type IEvent = MatrixSDK.IEvent;

export class MockUtils {
  constructor(
    private testState: { owner?: Owner; sdk?: MockSDK; opts?: Config },
  ) {}
  getRoomEvents = (roomId: string) => {
    return this.testState.sdk!.getRoomEvents(roomId);
  };
  getRoomIds = () => {
    return this.testState.sdk!.serverState.rooms.map((r) => r.id);
  };

  getRoomIdForRealmAndUser = (realmURL: string, userId: string) => {
    return `test-session-room-realm-${realmURL}-user-${userId}`;
  };

  getRoomState = (roomId: string, eventType: string, stateKey?: string) => {
    return this.testState.sdk!.serverState.getRoomState(
      roomId,
      eventType,
      stateKey,
    );
  };

  getRealmEventMessagesSince = (roomId: string, since: number) => {
    return this.testState
      .sdk!.serverState.getRoomEvents(roomId)
      .filter(
        (e: IEvent) => isRealmEvent(e) && e.origin_server_ts > since,
      ) as RealmEvent[];
  };

  setRealmPermissions = (permissions: Record<string, string[]>) => {
    this.testState.opts!.realmPermissions = permissions;
    (this.testState.owner!.lookup('service:realm') as RealmService).logout();
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
}

function isRealmEvent(e: IEvent): e is RealmEvent {
  return e.type === APP_BOXEL_REALM_EVENT_TYPE;
}
