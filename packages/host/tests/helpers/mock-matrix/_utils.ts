import Owner from '@ember/owner';

import RealmService from '@cardstack/host/services/realm';

import type { MockSDK } from './_sdk';
import type { Config } from '../mock-matrix';

import type * as MatrixSDK from 'matrix-js-sdk';

export class MockUtils {
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
    content: MatrixSDK.IEvent['content'],
    overrides?: { state_key?: string; origin_server_ts?: number },
  ) => {
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
  setExpiresInSec = (sec: number) => {
    this.opts.expiresInSec = sec;
  };
  setActiveRealms = (realmURLs: string[]) => {
    this.opts.activeRealms = realmURLs;
  };
  createAndJoinRoom = (sender: string, name: string, timestamp?: number) => {
    let roomId = this.testState.sdk!.serverState.createRoom(
      sender,
      name,
      timestamp,
    );
    return roomId;
  };
}
