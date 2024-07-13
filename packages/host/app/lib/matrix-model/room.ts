import { tracked } from '@glimmer/tracking';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import type {
  RoomCreateEvent,
  RoomNameEvent,
} from 'https://cardstack.com/base/matrix-event';

export class RoomModel {
  @tracked events: DiscreteMatrixEvent[] = [];

  get roomId() {
    return this.events.length > 0 ? this.events[0].room_id : undefined;
  }

  get created() {
    let event = this.events.find((e) => e.type === 'm.room.create') as
      | RoomCreateEvent
      | undefined;
    if (event) {
      return new Date(event.origin_server_ts);
    }
    // there is a race condition in the matrix SDK where newly created
    // rooms don't immediately have a created date
    return new Date();
  }

  get name() {
    // Read from this.events instead of this.newEvents to avoid a race condition bug where
    // newEvents never returns the m.room.name while the event is present in events
    let events = this.events
      .filter((e) => e.type === 'm.room.name')
      .sort(
        (a, b) => a.origin_server_ts - b.origin_server_ts,
      ) as RoomNameEvent[];
    if (events.length > 0) {
      return events.pop()!.content.name;
    }
    return;
  }

  get lastActiveTimestamp() {
    let maybeLastActive = this.events[this.events.length - 1]?.origin_server_ts;
    return maybeLastActive ?? this.created.getTime();
  }
}
