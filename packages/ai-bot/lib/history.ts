import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { type IRoomEvent } from 'matrix-js-sdk';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import { SerializedFileDef, downloadFile, MatrixClient } from './matrix';

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
   * message, and continuations combined into one message.
   */
  const latestEventsMap = new Map<string, DiscreteMatrixEvent>();
  for (let rawEvent of eventlist) {
    if (
      rawEvent.type !== 'm.room.message' &&
      rawEvent.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE
    ) {
      continue;
    }

    parseContentData(rawEvent);

    // make a copy of the event
    let event = { ...rawEvent };
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
    }
  }

  let latestEvents = Array.from(latestEventsMap.values());
  latestEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);

  const eventsWithoutContinuationsMap = new Map<string, DiscreteMatrixEvent>();

  for (let event of latestEvents) {
    await downloadAttachments(event, client);
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

function parseContentData(event: IRoomEvent) {
  if (event.content.data) {
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
