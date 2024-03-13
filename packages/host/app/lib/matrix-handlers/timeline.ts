import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';

import {
  type CardMessageContent,
  type CardFragmentContent,
  type MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';

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

  // patch in any missing room events--this will support dealing with local
  // echoes, migrating older histories as well as handle any matrix syncing gaps
  // that might occur
  if (
    roomField &&
    event.type === 'm.room.message' &&
    event.content?.msgtype === 'org.boxel.message'
  ) {
    let data = JSON.parse(event.content.data) as CardMessageContent['data'];
    if (
      'attachedCardsEventIds' in data &&
      Array.isArray(data.attachedCardsEventIds)
    ) {
      for (let attachedCardEventId of data.attachedCardsEventIds) {
        let currentFragment: string | undefined = attachedCardEventId;
        do {
          let fragmentEvent = roomField.events.find(
            (e) => e.event_id === currentFragment,
          );
          let fragmentData: CardFragmentContent['data'];
          if (!fragmentEvent) {
            fragmentEvent = (await context.client.fetchRoomEvent(
              roomId,
              attachedCardEventId,
            )) as DiscreteMatrixEvent;
            await addRoomEvent(context, fragmentEvent);
            fragmentData = JSON.parse(
              (fragmentEvent.content as any).data,
            ) as CardFragmentContent['data'];
          } else {
            if (
              fragmentEvent.type !== 'm.room.message' ||
              fragmentEvent.content.msgtype !== 'org.boxel.cardFragment'
            ) {
              throw new Error(
                `Expected event to be 'org.boxel.cardFragment' but was ${JSON.stringify(
                  fragmentEvent,
                )}`,
              );
            }
            fragmentData = fragmentEvent.content.data;
          }
          currentFragment = fragmentData?.nextFragment; // using '?' so we can be kind to older event schemas
        } while (currentFragment);
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
