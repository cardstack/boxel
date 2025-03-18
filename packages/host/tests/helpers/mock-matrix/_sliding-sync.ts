import * as MatrixSDK from 'matrix-js-sdk';
import {
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
  MSC3575List,
  MSC3575RoomSubscription,
} from 'matrix-js-sdk/lib/sliding-sync';

export class MockSlidingSync extends SlidingSync {
  private _client: MatrixSDK.MatrixClient;
  private lifecycleCallbacks: Function[] = [];
  private listCallbacks: Function[] = [];

  constructor(
    proxyBaseUrl: string,
    lists: Map<string, MSC3575List>,
    roomSubscriptionInfo: MSC3575RoomSubscription,
    client: MatrixSDK.MatrixClient,
    timeoutMS: number,
  ) {
    super(proxyBaseUrl, lists, roomSubscriptionInfo, client, timeoutMS);
    this._client = client;
  }

  on(event: string, callback: Function) {
    if (event === SlidingSyncEvent.Lifecycle) {
      this.lifecycleCallbacks.push(callback);
    }
    if (event === SlidingSyncEvent.List) {
      this.listCallbacks.push(callback);
    }
    return this;
  }

  emit(event: string, ...args: any[]) {
    if (event === SlidingSyncEvent.Lifecycle) {
      this.lifecycleCallbacks.forEach((cb) => cb(...args));
    }
    if (event === SlidingSyncEvent.List) {
      this.listCallbacks.forEach((cb) => cb(...args));
    }
    return true;
  }

  async start() {
    let aiRoomList = this.getListParams('ai-room');
    if (!aiRoomList) {
      return;
    }
    let slidingResponse = await this._client.slidingSync(
      {
        lists: { ['ai-room']: aiRoomList },
        room_subscriptions: undefined,
      },
      '',
      {} as any,
    );

    this.emit(
      SlidingSyncEvent.Lifecycle,
      SlidingSyncState.Complete,
      slidingResponse,
    );
  }

  async resend() {
    await this.start();
    return '';
  }
}
