import { debounce } from '@ember/runloop';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

import { eventDebounceMs } from '../matrix-utils';

import { addRoomEvent } from './index';

import type MatrixService from '../../services/matrix-service';
import type { Direction, MatrixEvent, RoomMember } from 'matrix-js-sdk';

export function onMembership(MatrixService: MatrixService) {
  return (event: MatrixEvent, member: RoomMember) => {
    MatrixService.roomMembershipQueue.push({ event, member });
    debouncedMembershipDrain(MatrixService);
  };
}

const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];

function debouncedMembershipDrain(MatrixService: MatrixService) {
  debounce(null, drainMembership, MatrixService, eventDebounceMs);
}

async function drainMembership(MatrixService: MatrixService) {
  await MatrixService.flushMembership;

  let eventsDrained: () => void;
  MatrixService.flushMembership = new Promise((res) => (eventsDrained = res));

  let events = [...MatrixService.roomMembershipQueue];
  MatrixService.roomMembershipQueue = [];

  await Promise.all(
    events.map(({ event: { event, status } }) =>
      addRoomEvent(MatrixService, { ...event, status }),
    ),
  );

  // For rooms that we have been invited to we are unable to get the full
  // timeline event yet (it's not available until we join the room), but we
  // still need to get enough room state events to reasonably render the
  // room card.
  for (let {
    event: { event: rawEvent },
    member,
  } of events) {
    let event = rawEvent as DiscreteMatrixEvent;
    let { room_id: roomId } = rawEvent as DiscreteMatrixEvent;
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }
    let room = MatrixService.client?.getRoom(roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${roomId}`,
      );
    }

    if (
      member.userId === MatrixService.client?.getUserId() &&
      event.type === 'm.room.member' &&
      room.getMyMembership() === 'invite'
    ) {
      if (event.content.membership === 'invite') {
        let stateEvents = room.getLiveTimeline().getState('f' as Direction)
          ?.events;
        if (!stateEvents) {
          throw new Error(`bug: cannot get state events for room ${roomId}`);
        }
        for (let eventType of STATE_EVENTS_OF_INTEREST) {
          let events = stateEvents.get(eventType);
          if (!events) {
            continue;
          }
          await Promise.all(
            [...events.values()]
              .map((e) => ({
                ...e.event,
                // annoyingly these events have been stripped of their id's
                event_id: `${roomId}_${eventType}_${e.localTimestamp}`,
                status: e.status,
              }))
              .map((event) => addRoomEvent(MatrixService, event)),
          );
        }
      }
    }
  }

  eventsDrained!();
}
