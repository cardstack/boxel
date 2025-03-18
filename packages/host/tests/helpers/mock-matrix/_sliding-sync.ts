import { MatrixEvent } from 'matrix-js-sdk';
import * as MatrixSDK from 'matrix-js-sdk';
import {
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
} from 'matrix-js-sdk/lib/sliding-sync';

export class MockSlidingSync extends SlidingSync {
  private lifecycleCallbacks: Function[] = [];
  private listCallbacks: Function[] = [];

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
    let slidingResponse = await this.client.slidingSync(
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

    Object.values(slidingResponse.rooms ?? {}).forEach(
      (room: MSC3575RoomData) => {
        room.timeline.forEach((event: MatrixSDK.IRoomEvent) => {
          this.client.emitEvent(new MatrixEvent(event));
        });
      },
    );
  }

  resend() {
    this.start();
  }
}
