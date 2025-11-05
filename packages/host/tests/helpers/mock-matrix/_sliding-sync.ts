import {
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
} from 'matrix-js-sdk/lib/sliding-sync';

import type * as MatrixSDK from 'matrix-js-sdk';
import type {
  MSC3575List,
  MSC3575RoomSubscription,
} from 'matrix-js-sdk/lib/sliding-sync';

export class MockSlidingSync extends SlidingSync {
  private _client: MatrixSDK.MatrixClient;
  private _lists: Record<string, MSC3575List>;
  private lifecycleCallbacks: Function[] = [];

  constructor(
    proxyBaseUrl: string,
    lists: Map<string, MSC3575List>,
    roomSubscriptionInfo: MSC3575RoomSubscription,
    client: MatrixSDK.MatrixClient,
    timeoutMS: number,
  ) {
    super(proxyBaseUrl, lists, roomSubscriptionInfo, client, timeoutMS);
    this._client = client;
    this._lists = Object.fromEntries(lists);
  }

  on(event: string, callback: Function) {
    if (event === SlidingSyncEvent.Lifecycle) {
      this.lifecycleCallbacks.push(callback);
    }
    return this;
  }

  emit(event: string, ...args: any[]) {
    if (event === SlidingSyncEvent.Lifecycle) {
      this.lifecycleCallbacks.forEach((cb) => cb(...args));
    }
    return true;
  }

  async start() {
    if (!this._lists) {
      return;
    }
    let slidingResponse = await this._client.slidingSync(
      {
        lists: this._lists,
        room_subscriptions: undefined,
      },
      '',
      {} as any,
    );

    this.emit(
      SlidingSyncEvent.Lifecycle,
      SlidingSyncState.RequestFinished,
      slidingResponse,
    );

    this.emit(
      SlidingSyncEvent.Lifecycle,
      SlidingSyncState.Complete,
      slidingResponse,
    );
  }

  async setListRanges(listKey: string, ranges: number[][]) {
    this._lists[listKey].ranges = ranges;
    return await this.resend();
  }

  async resend() {
    await this.start();
    return Promise.resolve('');
  }

  async triggerRoomSync(roomId: string, roomName?: string, serverState?: any) {
    if (!this.lifecycleCallbacks.length) {
      return;
    }

    // Create a mock sliding sync response that includes the new room
    let mockResponse = {
      pos: String(Date.now()),
      lists: {
        ['ai-room']: {
          count: 1,
          ops: [
            {
              op: 'SYNC',
              range: [0, (serverState?.rooms?.length || 1) - 1],
              room_ids: [roomId],
            },
          ],
        },
      },
      rooms: {
        [roomId]: {
          name: roomName || 'room',
          required_state: [],
          timeline: serverState?.getRoomEvents?.(roomId) || [],
          notification_count: 0,
          highlight_count: 0,
          joined_count: 1,
          invited_count: 0,
          initial: true,
        },
      },
      extensions: {},
    };

    // Trigger the lifecycle events that the matrix service is waiting for
    this.emit(
      SlidingSyncEvent.Lifecycle,
      SlidingSyncState.RequestFinished,
      mockResponse,
    );
    this.emit(
      SlidingSyncEvent.Lifecycle,
      SlidingSyncState.Complete,
      mockResponse,
    );
  }
}
