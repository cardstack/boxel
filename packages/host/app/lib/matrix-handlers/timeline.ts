import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';
import { Context, Event } from './index';
import { eventDebounceMs } from '../matrix-utils';
import { type LooseCardResource } from '@cardstack/runtime-common';
import { type Card } from 'https://cardstack.com/base/card-api';

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
  let { event_id: eventId, room_id: roomId, content } = event;
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
  if (
    event.type === 'org.boxel.roomEventConsumer' &&
    !context.roomEventConsumers.has(roomId)
  ) {
    if (!content) {
      throw new Error(
        `bug: content is undefined for event ${JSON.stringify(event, null, 2)}`
      );
    }
    let data: LooseCardResource = {
      meta: {
        adoptsFrom: content.ref as { module: string; name: string },
      },
    };
    let card = await context.cardAPI.createFromSerialized<typeof Card>(
      data,
      { data },
      undefined
    );
    context.roomEventConsumers.set(roomId, {
      card,
      eventsField: content.eventsField,
    });
    // flush all the timeline events fired before this event was fired (sadly
    // events are not always fired in chronological order)
    let existingTimeline = context.timelines.get(roomId);
    if (existingTimeline) {
      (card as any)[content.eventsField] = [...[...existingTimeline.values()]];
    }
  }

  let roomCardEntry = context.roomEventConsumers.get(roomId);
  if (roomCardEntry) {
    let { card: roomCard, eventsField } = roomCardEntry;
    if (
      !(eventsField in roomCard) ||
      !Array.isArray((roomCard as any)[eventsField])
    ) {
      throw new Error(
        `room event consumer card ${roomCard.constructor.name} does not have an array events property '${eventsField}'`
      );
    }
    let existingEvents = (roomCard as any)[eventsField] as Event[];
    // duplicate events may be emitted from matrix
    if (!existingEvents.find((e) => e.event_id === eventId)) {
      (roomCard as any)[eventsField] = [...existingEvents, event];
    }
  }

  if (event.type === 'm.room.message' || event.type === 'm.room.encrypted') {
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for message event ${JSON.stringify(
          event,
          null,
          2
        )}`
      );
    }
    let timeline = context.timelines.get(roomId);
    if (!timeline) {
      timeline = new context.mapClazz<string, Event>();
      context.timelines.set(roomId, timeline);
      // we need to scroll back to capture any room events fired before this one
      // (most notably the org.boxel.roomConsumer event used to establish the room card)
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
