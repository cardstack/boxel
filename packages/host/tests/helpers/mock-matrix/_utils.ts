import Owner from '@ember/owner';

import RealmService from '@cardstack/host/services/realm';

import type { MockSDK } from './_sdk';
import type { Config } from '../mock-matrix';

import type * as MatrixSDK from 'matrix-js-sdk';

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
  getRoomState = (roomId: string, eventType: string, stateKey?: string) => {
    return this.testState.sdk!.serverState.getRoomState(
      roomId,
      eventType,
      stateKey,
    );
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
    },
  ) => {
    if (content.isStreamingFinished === undefined) {
      content.isStreamingFinished = true;
    }
    return this.testState.sdk!.serverState.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.message',
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
