import debounce from 'lodash/debounce';
import { type MatrixEvent, type RoomMember } from 'matrix-js-sdk';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';

import { eventDebounceMs } from '../matrix-utils';

import { type Context, addRoomEvent } from './index';

export function onMembership(context: Context) {
  return (event: MatrixEvent, member: RoomMember) => {
    context.roomMembershipQueue.push({ event, member });
    debouncedMembershipDrain(context);
  };
}

const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];

const debouncedMembershipDrain = debounce((context: Context) => {
  drainMembership(context);
}, eventDebounceMs);

async function drainMembership(context: Context) {
  await context.flushMembership;

  let eventsDrained: () => void;
  context.flushMembership = new Promise((res) => (eventsDrained = res));

  let events = [...context.roomMembershipQueue];
  context.roomMembershipQueue = [];

  await Promise.all(
    events.map(({ event: { event, status } }) =>
      addRoomEvent(context, { ...event, status }),
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
    let room = context.client.getRoom(roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${roomId}`,
      );
    }

    if (
      member.userId === context.client.getUserId() &&
      event.type === 'm.room.member' &&
      room.getMyMembership() === 'invite'
    ) {
      if (event.content.membership === 'invite') {
        let stateEvents = room
          .getLiveTimeline()
          .getState(context.matrixSDK.EventTimeline.FORWARDS)?.events;
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
              .map((event) => addRoomEvent(context, event)),
          );
        }
      }
    }
  }

  eventsDrained!();
}
