import debounce from 'lodash/debounce';
import { Room, type MatrixEvent } from 'matrix-js-sdk';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  type CardMessageContent,
  type CardFragmentContent,
  type MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/matrix-event';

import { eventDebounceMs } from '../matrix-utils';

import { type Event, addRoomEvent, updateRoomEvent } from './index';

export function onReceipt(MatrixService: MatrixService) {
  return async (e: MatrixEvent) => {
    let userId = MatrixService.client?.credentials.userId;
    if (userId) {
      let eventIds = Object.keys(e.getContent());
      for (let eventId of eventIds) {
        let receipt = e.getContent()[eventId]['m.read'][userId];
        if (receipt) {
          MatrixService.addEventReadReceipt(eventId, { readAt: receipt.ts });
        }
      }
    }
  };
}

export function onTimeline(MatrixService: MatrixService) {
  return (e: MatrixEvent) => {
    MatrixService.timelineQueue.push({ event: e });
    debouncedTimelineDrain(MatrixService);
  };
}

export function onUpdateEventStatus(MatrixService: MatrixService) {
  return (e: MatrixEvent, _room: Room, maybeOldEventId?: unknown) => {
    if (typeof maybeOldEventId !== 'string') {
      return;
    }
    MatrixService.timelineQueue.push({ event: e, oldEventId: maybeOldEventId });
    debouncedTimelineDrain(MatrixService);
  };
}

const debouncedTimelineDrain = debounce((MatrixService: MatrixService) => {
  drainTimeline(MatrixService);
}, eventDebounceMs);

async function drainTimeline(MatrixService: MatrixService) {
  await MatrixService.flushTimeline;

  let eventsDrained: () => void;
  MatrixService.flushTimeline = new Promise((res) => (eventsDrained = res));
  let events = [...MatrixService.timelineQueue];
  MatrixService.timelineQueue = [];
  for (let { event, oldEventId } of events) {
    await MatrixService.client?.decryptEventIfNeeded(event);
    await processDecryptedEvent(
      MatrixService,
      {
        ...event.event,
        status: event.status,
        content: event.getContent() || undefined,
        error: event.error ?? undefined,
      },
      oldEventId,
    );
  }
  eventsDrained!();
}

async function processDecryptedEvent(
  MatrixService: MatrixService,
  event: Event,
  oldEventId?: string,
) {
  let { room_id: roomId } = event;
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

  let userId = MatrixService.client?.getUserId();
  if (!userId) {
    throw new Error(
      `bug: userId is required for event ${JSON.stringify(event, null, 2)}`,
    );
  }

  // We might still receive events from the rooms that the user has left.
  let member = room.getMember(userId);
  if (!member || member.membership !== 'join') {
    return;
  }

  let roomState = await MatrixService.getRoom(roomId);
  // patch in any missing room events--this will support dealing with local
  // echoes, migrating older histories as well as handle any matrix syncing gaps
  // that might occur
  if (
    roomState &&
    event.type === 'm.room.message' &&
    event.content?.msgtype === 'org.boxel.message' &&
    event.content.data
  ) {
    let data = (
      typeof event.content.data === 'string'
        ? JSON.parse(event.content.data)
        : event.content.data
    ) as CardMessageContent['data'];
    if (
      'attachedCardsEventIds' in data &&
      Array.isArray(data.attachedCardsEventIds)
    ) {
      for (let attachedCardEventId of data.attachedCardsEventIds) {
        let currentFragmentId: string | undefined = attachedCardEventId;
        do {
          let fragmentEvent = roomState.events.find(
            (e: DiscreteMatrixEvent) => e.event_id === currentFragmentId,
          );
          let fragmentData: CardFragmentContent['data'];
          if (!fragmentEvent) {
            fragmentEvent = (await MatrixService.client?.fetchRoomEvent(
              roomId,
              currentFragmentId ?? '',
            )) as DiscreteMatrixEvent;
            if (
              fragmentEvent.type !== 'm.room.message' ||
              fragmentEvent.content.msgtype !== 'org.boxel.cardFragment'
            ) {
              throw new Error(
                `Expected event ${currentFragmentId} to be 'org.boxel.card' but was ${JSON.stringify(
                  fragmentEvent,
                )}`,
              );
            }
            await addRoomEvent(MatrixService, {
              ...fragmentEvent,
              status: null,
            });
            fragmentData = (
              typeof fragmentEvent.content.data === 'string'
                ? JSON.parse((fragmentEvent.content as any).data)
                : fragmentEvent.content.data
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
          currentFragmentId = fragmentData?.nextFragment; // using '?' so we can be kind to older event schemas
        } while (currentFragmentId);
      }
    }
  }
  if (oldEventId) {
    await updateRoomEvent(MatrixService, event, oldEventId);
  } else {
    await addRoomEvent(MatrixService, event);
  }

  if (room.oldState.paginationToken != null) {
    // we need to scroll back to capture any room events fired before this one
    await MatrixService.client?.scrollback(room);
  }
}
