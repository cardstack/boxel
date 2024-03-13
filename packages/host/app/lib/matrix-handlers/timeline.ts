import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';

import { eventDebounceMs } from '../matrix-utils';

import { type Context, type Event, addRoomEvent } from './index';

export function onTimeline(context: Context) {
  return (e: MatrixEvent) => {
    context.timelineQueue.push(e);
    debouncedTimelineDrain(context);
  };
}

const debouncedTimelineDrain = debounce((context: Context) => {
  drainTimeline(context);
}, eventDebounceMs);

async function drainTimeline(context: Context) {
  await context.flushTimeline;

  let eventsDrained: () => void;
  context.flushTimeline = new Promise((res) => (eventsDrained = res));
  let events = [...context.timelineQueue];
  context.timelineQueue = [];
  for (let event of events) {
    await context.client.decryptEventIfNeeded(event);
    await processDecryptedEvent(context, {
      ...event.event,
      content: event.getContent() || undefined,
    });
  }
  eventsDrained!();
}

async function processDecryptedEvent(context: Context, event: Event) {
  let { room_id: roomId } = event;
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }

  let roomField = await context.rooms.get(roomId);

  // This logic is necessary to migrate historic events--unsure if we should
  // continue to care about this as it is added tech debt.
  if (
    roomField &&
    event.type === 'm.room.message' &&
    event.content?.msgtype === 'org.boxel.message'
  ) {
    let data = JSON.parse(event.content.data);
    if (
      'attachedCardsEventIds' in data &&
      Array.isArray(data.attachedCardsEventIds)
    ) {
      for (let attachedCardEventId of data.attachedCardsEventIds) {
        if (!roomField.events.find((e) => e.event_id === attachedCardEventId)) {
          let fragmentEvent = await context.client.fetchRoomEvent(
            roomId,
            attachedCardEventId,
          );
          await addRoomEvent(context, fragmentEvent);
        }
      }
    }
  }

  await addRoomEvent(context, event);

  let room = context.client.getRoom(roomId);
  if (!room) {
    throw new Error(
      `bug: should never get here--matrix sdk returned a null room for ${roomId}`,
    );
  }
  if (room.oldState.paginationToken != null) {
    // we need to scroll back to capture any room events fired before this one
    await context.client.scrollback(context.client.getRoom(roomId)!);
  }
}
