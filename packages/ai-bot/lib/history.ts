import type {
  CardMessageEvent,
  CodePatchResultEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
  RealmServerEvent,
} from 'https://cardstack.com/base/matrix-event';
import { type IRoomEvent } from 'matrix-js-sdk';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import { SerializedFileDef, downloadFile, MatrixClient } from './matrix/util';

let log = logger('ai-bot:history');

export class HistoryConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryConstructionError';
  }
}
export async function constructHistory(
  eventlist: IRoomEvent[],
  client: MatrixClient,
) {
  /**
   * We send a lot of events to create messages,
   * as we stream updates to the UI. This works by
   * sending a new event with the full content and
   * information about which event it should replace
   *
   * This function is to construct the chat as a user
   * would see it - with only the latest event for each
   * message.
   *
   * When replacements are applied, the server aggregates
   * them into a single event.
   */
  const eventListWithReplacementsApplied = applyAllReplacements(eventlist);

  const latestEventsMap = new Map<string, DiscreteMatrixEvent>();
  for (let rawEvent of eventListWithReplacementsApplied) {
    if (
      rawEvent.type !== 'm.room.message' &&
      rawEvent.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
      rawEvent.type !== APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE
    ) {
      continue;
    }

    parseContentData(rawEvent);

    // make a copy of the event
    let event = { ...rawEvent } as
      | CardMessageEvent
      | CommandResultEvent
      | CodePatchResultEvent
      | RealmServerEvent
      | MessageEvent; // Typescript could have inferred this from the line above
    let eventId = event.event_id!;

    // replace events with their replacement

    // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
    if (event.content['m.relates_to']?.rel_type === 'm.replace') {
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
      eventId = event.content['m.relates_to']!.event_id!;
      event.event_id = eventId;
    }
    const existingEvent = latestEventsMap.get(eventId);
    if (
      !existingEvent ||
      // we check the timestamps of the events because the existing event may
      // itself be an already replaced event. The idea is that you can perform
      // multiple replacements on an event. In order to prevent backing out a
      // subsequent replacement we also assert that the replacement timestamp is
      // after the event that it is replacing
      existingEvent.origin_server_ts < event.origin_server_ts
    ) {
      latestEventsMap.set(eventId, event as DiscreteMatrixEvent);
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
      if (event.content['m.relates_to']?.rel_type === 'm.replace') {
        // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
        delete event.content['m.relates_to'];
      }
    }
  }

  let reverseChronologicalEvents = Array.from(latestEventsMap.values());
  reverseChronologicalEvents.sort(
    (a, b) => b.origin_server_ts - a.origin_server_ts,
  );

  const continuationEventsMap = new Map<string, CardMessageEvent>();
  const eventsWithoutContinuationsMap = new Map<string, DiscreteMatrixEvent>();

  for (let event of reverseChronologicalEvents) {
    await downloadAttachments(event, client);

    if (
      event.type === 'm.room.message' &&
      event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      let hasContinuation =
        event.content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY];
      if (hasContinuation) {
        let continuationEvent = continuationEventsMap.get(event.event_id!);
        if (continuationEvent) {
          event.content.body += continuationEvent.content.body;
          event.content[APP_BOXEL_REASONING_CONTENT_KEY] =
            event.content[APP_BOXEL_REASONING_CONTENT_KEY] ??
            '' + continuationEvent.content[APP_BOXEL_REASONING_CONTENT_KEY] ??
            '';
          event.content[APP_BOXEL_COMMAND_REQUESTS_KEY] = (
            event.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []
          ).concat(
            continuationEvent.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? [],
          );
          event.origin_server_ts = continuationEvent.origin_server_ts;
          delete event.content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY];
        }
      }
      let continuationOfEventId =
        event.content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY];
      if (continuationOfEventId) {
        continuationEventsMap.set(
          continuationOfEventId,
          event as CardMessageEvent,
        );
        continue;
      }
    }
    eventsWithoutContinuationsMap.set(
      event.event_id!,
      event as DiscreteMatrixEvent,
    );
  }

  let eventsWithoutContinuations = Array.from(
    eventsWithoutContinuationsMap.values(),
  );
  eventsWithoutContinuations.sort(
    (a, b) => a.origin_server_ts - b.origin_server_ts,
  );
  return eventsWithoutContinuations;
}

function getAggregatedReplacement(event: IRoomEvent) {
  /**
   * When replacements are applied, the server aggregates
   * them into a single event.
   *
   * The latest version is placed within the unsigned
   * section of the event.
   *
   * Here we extract any replacement and return the
   * latest version, but with *the original id*
   */
  let finalRawEvent: IRoomEvent;
  const originalEventId = event.event_id;
  let replacedRawEvent: IRoomEvent =
    event.unsigned?.['m.relations']?.['m.replace'];
  if (replacedRawEvent) {
    finalRawEvent = replacedRawEvent;
    finalRawEvent.event_id = originalEventId;
  } else {
    finalRawEvent = event;
  }
  return finalRawEvent;
}

function applyAllReplacements(eventlist: IRoomEvent[]): IRoomEvent[] {
  // First apply any server-side aggregations
  let eventsWithAggregatedReplacements = eventlist.map(
    getAggregatedReplacement,
  );
  // Now if the event list we have doesn't have aggregations but still
  // has replacements, we need to apply them manually
  // TODO: remove this as part of #CS-8662
  let eventsMap = new Map<string, IRoomEvent>();
  for (let event of eventsWithAggregatedReplacements) {
    let canonicalEventId;
    if (event.content['m.relates_to']?.rel_type === 'm.replace') {
      canonicalEventId = event.content['m.relates_to'].event_id!;
    } else {
      canonicalEventId = event.event_id!;
    }
    if (eventsMap.has(canonicalEventId)) {
      let existingEvent = eventsMap.get(canonicalEventId)!;
      // Events can be replaced multiple times, we only want the latest version
      if (existingEvent.origin_server_ts < event.origin_server_ts) {
        event.event_id = canonicalEventId;
        eventsMap.set(canonicalEventId, event);
      }
    } else {
      eventsMap.set(canonicalEventId, event);
    }
  }
  let updatedEvents = Array.from(eventsMap.values());
  updatedEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  return updatedEvents;
}

function parseContentData(event: IRoomEvent) {
  if (event.content.data && typeof event.content.data === 'string') {
    try {
      event.content.data = JSON.parse(event.content.data);
    } catch (e) {
      Sentry.captureException(e, {
        attachments: [
          {
            data: event.content.data,
            filename: 'rawEventContentData.txt',
          },
        ],
      });
      log.error('Error parsing JSON', e);
      throw new HistoryConstructionError((e as Error).message);
    }
  }
}

async function downloadAttachments(event: IRoomEvent, client: MatrixClient) {
  if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
    let { attachedCards } = event.content.data ?? {};
    if (attachedCards && attachedCards.length > 0) {
      event.content.data.attachedCards = await Promise.all(
        attachedCards.map(async (attachedCard: SerializedFileDef) => {
          try {
            return {
              ...attachedCard,
              content: await downloadFile(client, attachedCard),
            };
          } catch (e) {
            return {
              ...attachedCard,
              error: `Error loading attached card: ${e}`,
            };
          }
        }),
      );
    }
  } else if (
    event.content.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE &&
    event.content.data.card
  ) {
    try {
      event.content.data.card = {
        ...event.content.data.card,
        content: await downloadFile(client, event.content.data.card),
      };
    } catch (e) {
      event.content.data.card = {
        ...event.content.data.card,
        error: `Error loading attached card: ${e}`,
      };
    }
  }
}
