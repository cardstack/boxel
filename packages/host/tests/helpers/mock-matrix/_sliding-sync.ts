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
  setListCalls: Array<{ listKey: string; list: MSC3575List }> = [];

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

  off(event: string, callback: Function) {
    if (event === SlidingSyncEvent.Lifecycle) {
      this.lifecycleCallbacks = this.lifecycleCallbacks.filter(
        (existing) => existing !== callback,
      );
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

  setList(listKey: string, list: MSC3575List) {
    this.setListCalls.push({ listKey, list });
    this._lists[listKey] = list;
    void this.resend();
  }

  async resend() {
    await this.start();
    return Promise.resolve('');
  }

  async triggerRoomSync(roomId: string, roomName?: string, serverState?: any) {
    if (!this.lifecycleCallbacks.length) {
      return;
    }

    // The room is reported in the list whose room-type filters admit it, as
    // the homeserver would: a typed room goes to the list that asks for its
    // type, and to the AI room list only when that list doesn't exclude it.
    let roomType = (() => {
      try {
        return serverState?.getRoomState?.(roomId, 'm.room.create', '')?.content
          ?.type as string | undefined;
      } catch {
        return undefined;
      }
    })();
    let listKey =
      (roomType &&
        Object.keys(this._lists).find((key) =>
          this._lists[key]?.filters?.room_types?.includes(roomType),
        )) ||
      'ai-room';
    if (
      listKey === 'ai-room' &&
      roomType &&
      this._lists['ai-room']?.filters?.not_room_types?.includes(roomType)
    ) {
      return;
    }

    // Create a mock sliding sync response that includes the new room
    let mockResponse = {
      pos: String(Date.now()),
      lists: {
        [listKey]: {
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

  stop() {
    this.lifecycleCallbacks = [];
  }
}
