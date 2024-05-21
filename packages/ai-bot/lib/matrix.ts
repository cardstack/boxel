import { IContent, Room, MatrixClient } from 'matrix-js-sdk';
import { logger } from '@cardstack/runtime-common';
import { OpenAIError } from 'openai/error';
import * as Sentry from '@sentry/node';

let log = logger('ai-bot');

export async function sendEvent(
  client: MatrixClient,
  room: Room,
  eventType: string,
  content: IContent,
  eventToUpdate: string | undefined,
) {
  if (content.data) {
    content.data = JSON.stringify(content.data);
  }
  if (eventToUpdate) {
    content['m.relates_to'] = {
      rel_type: 'm.replace',
      event_id: eventToUpdate,
    };
  }
  log.debug('sending event', content);
  return await client.sendEvent(room.roomId, eventType, content);
}

export async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  eventToUpdate: string | undefined,
  data: any = {},
) {
  log.debug('sending message', content);
  let messageObject: IContent = {
    ...{
      body: content,
      msgtype: 'm.text',
      formatted_body: content,
      format: 'org.matrix.custom.html',
      'm.new_content': {
        body: content,
        msgtype: 'm.text',
        formatted_body: content,
        format: 'org.matrix.custom.html',
      },
    },
    ...data,
  };
  return await sendEvent(
    client,
    room,
    'm.room.message',
    messageObject,
    eventToUpdate,
  );
}

// TODO we might want to think about how to handle patches that are larger than
// 65KB (the maximum matrix event size), such that we split them into fragments
// like we split cards into fragments
export async function sendOption(
  client: MatrixClient,
  room: Room,
  patch: any,
  eventToUpdate: string | undefined,
) {
  log.debug('sending option', patch);
  const id = patch['card_id'];
  const body = patch['description'] || "Here's the change:";
  let messageObject = {
    body: body,
    msgtype: 'org.boxel.command',
    formatted_body: body,
    format: 'org.matrix.custom.html',
    data: {
      command: {
        type: 'patchCard',
        id: id,
        patch: {
          attributes: patch['attributes'],
          relationships: patch['relationships'],
        },
        eventId: eventToUpdate,
      },
    },
  };
  return await sendEvent(
    client,
    room,
    'm.room.message',
    messageObject,
    eventToUpdate,
  );
}

export async function sendError(
  client: MatrixClient,
  room: Room,
  error: any,
  eventToUpdate: string | undefined,
) {
  try {
    let errorMessage = getErrorMessage(error);
    log.error(errorMessage);
    await sendMessage(
      client,
      room,
      'There was an error processing your request, please try again later',
      eventToUpdate,
      {
        isStreamingFinished: true,
        errorMessage,
      },
    );
  } catch (e) {
    // We've had a problem sending the error message back to the user
    // Log and continue
    log.error(`Error sending error message back to user: ${e}`);
    Sentry.captureException(e);
  }
}

function getErrorMessage(error: any): string {
  if (error instanceof OpenAIError) {
    return `OpenAI error: ${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return `Unknown error: ${error}`;
  }
  return `Unknown error`;
}
