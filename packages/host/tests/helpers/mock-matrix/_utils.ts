import Owner from '@ember/owner';

import RealmService from '@cardstack/host/services/realm';

import type { MockSDK } from './_sdk';
import type { Config } from '../mock-matrix';

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
    content: {
      msgtype: string;
      body: string;
      formatted_body: string;
      format?: string;
      data?: any;
      isStreamingFinished?: boolean;
      errorMessage?: string;
      'm.relates_to'?: { rel_type: string; event_id: string };
      'm.new_content'?: {
        body: string;
        msgtype: string;
        formatted_body: string;
        format: string;
      };
    },
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
  createAndJoinRoom = async (
    sender: string,
    name: string,
    timestamp = Date.now(),
  ) => {
    let roomId = this.testState.sdk!.serverState.createRoom(
      sender,
      name,
      timestamp,
    );
    return Promise.resolve(roomId);
  };
}
