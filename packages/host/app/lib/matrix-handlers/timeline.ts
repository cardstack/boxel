import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';
import { Context, Event } from './index';
import { eventDebounceMs } from '../matrix-utils';
import type { Card } from 'https://cardstack.com/base/card-api';
import {
  type LooseCardResource,
  type CardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

type createFromSerializedType = (
  resource: LooseCardResource,
  doc: LooseSingleCardDocument | CardDocument,
  relativeTo: URL | undefined
) => Promise<Card>;

export function onTimeline(
  context: Context,
  createFromSerialized: createFromSerializedType
) {
  return (e: MatrixEvent) => {
    context.timelineQueue.push(e);
    debouncedTimelineDrain(context, createFromSerialized);
  };
}

const debouncedTimelineDrain = debounce(
  (context: Context, createFromSerialized: createFromSerializedType) => {
    drainTimeline(context, createFromSerialized);
  },
  eventDebounceMs
);

async function drainTimeline(
  context: Context,
  createFromSerialized: createFromSerializedType
) {
  await context.flushTimeline;

  let eventsDrained: () => void;
  context.flushTimeline = new Promise((res) => (eventsDrained = res));
  let events = [...context.timelineQueue];
  context.timelineQueue = [];
  for (let event of events) {
    await context.client.decryptEventIfNeeded(event);
    await processDecryptedEvent(
      context,
      {
        ...event.event,
        content: event.getContent() || undefined,
      },
      createFromSerialized
    );
  }
  eventsDrained!();
}

async function processDecryptedEvent(
  context: Context,
  event: Event,
  createFromSerialized: createFromSerializedType
) {
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
    let card = await createFromSerialized(data, { data }, undefined);
    context.roomEventConsumers.set(roomId, {
      card,
      eventsField: content.eventsField,
    });
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
      (roomCard as any)[eventsField].push(event);
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
    }
    // we use a map for the timeline to de-dupe events
    let performCallback = !timeline.has(eventId);
    timeline.set(eventId, event);
    if (performCallback && context.handleMessage) {
      await context.handleMessage(context, event, roomId);
    }
  }
}
