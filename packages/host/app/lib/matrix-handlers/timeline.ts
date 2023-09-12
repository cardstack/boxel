import debounce from 'lodash/debounce';
import { type MatrixEvent } from 'matrix-js-sdk';
import {
  type Context,
  type Event,
  addRoomEvent,
  recomputeRoomObjective,
} from './index';
import { eventDebounceMs } from '../matrix-utils';
import { type MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';
import { type RoomObjectiveField } from 'https://cardstack.com/base/room-objective';
import {
  type LooseSingleCardDocument,
  type MatrixCardError,
  isMatrixCardError,
} from '@cardstack/runtime-common';

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
  let { room_id: roomId } = event;
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let discreteEvent = event as DiscreteMatrixEvent;
  if (
    discreteEvent.type === 'm.room.message' &&
    discreteEvent.content.msgtype === 'org.boxel.objective'
  ) {
    let objective = await context.roomObjectives.get(roomId);
    if (!objective) {
      let doc = {
        data: {
          meta: {
            adoptsFrom: discreteEvent.content.ref,
          },
        },
      } as LooseSingleCardDocument;
      let room = await context.rooms.get(roomId);
      let objective: RoomObjectiveField | MatrixCardError;
      try {
        if (!room) {
          throw new Error(`could not get room card for room '${roomId}'`);
        }
        objective = await context.cardAPI.createFromSerialized<
          typeof RoomObjectiveField
        >(doc.data, doc, undefined, context.loaderService.loader);
      } catch (error: any) {
        objective = {
          id: doc.data.id,
          error,
        } as MatrixCardError;
      }
      if (!isMatrixCardError(objective) && room) {
        objective.room = room;
      }
      context.roomObjectives.set(roomId, objective);
    }
  }

  await recomputeRoomObjective(context, roomId);

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
