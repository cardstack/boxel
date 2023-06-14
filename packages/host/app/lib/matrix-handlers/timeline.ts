import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';
import { type Context, type Event, addRoomEvent } from './index';
import { TrackedMap } from 'tracked-built-ins';
import { eventDebounceMs } from '../matrix-utils';

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
  await addRoomEvent(context, event);

  // TODO the room card already handles this--probably we can remove it...
  let { event_id: eventId, room_id: roomId } = event;
  if (event.type === 'm.room.message' || event.type === 'm.room.encrypted') {
    if (!eventId) {
      throw new Error(
        `bug: event ID is undefined for event ${JSON.stringify(event, null, 2)}`
      );
    }
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`
      );
    }

    let timeline = context.timelines.get(roomId);
    if (!timeline) {
      timeline = new TrackedMap();
      context.timelines.set(roomId, timeline);
      // we need to scroll back to capture any room events fired before this one
      // TODO if we replace this functionality with teh room card--then we'll
      // need to move this scrollback.
      await context.client.scrollback(context.client.getRoom(roomId)!);
    }
    // we use a map for the timeline to de-dupe events
    let performCallback = !timeline.has(eventId);
    timeline.set(eventId, event);
    if (performCallback && context.handleMessage) {
      await context.handleMessage(context, event, roomId);
    }
  }
}
