import type {
  CardMessageEvent,
  CardMessageContent,
  CodePatchResultEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
  RealmServerEvent,
} from 'https://cardstack.com/base/matrix-event';
import type { MatrixClient } from 'matrix-js-sdk';
import type { IRoomEvent } from 'matrix-js-sdk';

import { logger } from '../log';
import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_PATCH_SUMMARY_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '../matrix-constants';

import { downloadFile } from './matrix-utils';
import type { SerializedFileDef } from 'https://cardstack.com/base/file-api';
import { HistoryConstructionError } from './types';

function getLog() {
  return logger('ai-bot:history');
}

export async function constructHistory(
  eventlist: IRoomEvent[],
  client: MatrixClient,
) {
  /**
   * Return a list of all message events and command/patch result events for the room,
   * in chronological order
   */

  const latestEventsMap = new Map<string, DiscreteMatrixEvent>();
  let eventsWithAggregatedReplacements = eventlist.map(
    getAggregatedReplacement,
  );
  for (let rawEvent of eventsWithAggregatedReplacements) {
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

    // Simple deduplication by event ID - no replacement processing needed
    // since replacement events are filtered out at the API level
    const existingEvent = latestEventsMap.get(eventId);
    if (
      !existingEvent ||
      existingEvent.origin_server_ts < event.origin_server_ts
    ) {
      latestEventsMap.set(eventId, event as DiscreteMatrixEvent);
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
      (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
        event.content.msgtype === APP_BOXEL_PATCH_SUMMARY_MSGTYPE)
    ) {
      // Content types here must be CardMessageContent
      // as we have already filtered for APP_BOXEL_MESSAGE_MSGTYPE
      let content = event.content as CardMessageContent;
      let hasContinuation = content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY];
      if (hasContinuation) {
        let continuationEvent = continuationEventsMap.get(event.event_id!);
        if (continuationEvent) {
          let continuationContent =
            continuationEvent.content as CardMessageContent;
          content.body += continuationContent.body;
          content[APP_BOXEL_REASONING_CONTENT_KEY] =
            content[APP_BOXEL_REASONING_CONTENT_KEY] ??
            '' + (continuationContent[APP_BOXEL_REASONING_CONTENT_KEY] ?? '');
          content[APP_BOXEL_COMMAND_REQUESTS_KEY] = (
            content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []
          ).concat(continuationContent[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []);
          event.origin_server_ts = continuationEvent.origin_server_ts;
          delete content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY];
        }
      }
      let continuationOfEventId =
        content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY];
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

function parseContentData(event: IRoomEvent) {
  if (event.content.data && typeof event.content.data === 'string') {
    try {
      event.content.data = JSON.parse(event.content.data);
    } catch (e) {
      getLog().error('Error parsing JSON', e);
      throw new HistoryConstructionError((e as Error).message);
    }
  }
}

async function downloadAttachments(event: IRoomEvent, client: MatrixClient) {
  if (
    event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
    event.content.msgtype === APP_BOXEL_PATCH_SUMMARY_MSGTYPE
  ) {
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
