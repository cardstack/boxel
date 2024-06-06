import { IContent } from 'matrix-js-sdk';
import { logger } from '@cardstack/runtime-common';
import { OpenAIError } from 'openai/error';
import * as Sentry from '@sentry/node';

let log = logger('ai-bot');

export interface MatrixClient {
  sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
  ): Promise<{ event_id: string }>;

  setRoomName(roomId: string, title: string): Promise<{ event_id: string }>;
}

export async function sendEvent(
  client: MatrixClient,
  roomId: string,
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
  return await client.sendEvent(roomId, eventType, content);
}

export async function sendMessage(
  client: MatrixClient,
  roomId: string,
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
    roomId,
    'm.room.message',
    messageObject,
    eventToUpdate,
  );
}

export interface FunctionToolCall {
  name: 'searchCard' | 'patchCard';
  arguments: any;
}

// TODO we might want to think about how to handle patches that are larger than
// 65KB (the maximum matrix event size), such that we split them into fragments
// like we split cards into fragments
export async function sendOption(
  client: MatrixClient,
  roomId: string,
  functionCall: FunctionToolCall,
  eventToUpdate: string | undefined,
) {
  let messageObject = toMatrixMessageContent(functionCall, eventToUpdate);

  if (messageObject !== undefined) {
    return await sendEvent(
      client,
      roomId,
      'm.room.message',
      messageObject,
      eventToUpdate,
    );
  }
  return;
}

export async function sendError(
  client: MatrixClient,
  roomId: string,
  error: any,
  eventToUpdate: string | undefined,
) {
  try {
    let errorMessage = getErrorMessage(error);
    log.error(errorMessage);
    await sendMessage(
      client,
      roomId,
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

export const toMatrixMessageContent = (
  functionCall: FunctionToolCall,
  eventToUpdate: string | undefined,
): IContent | undefined => {
  let { arguments: payload } = functionCall;
  if (functionCall.name === 'patchCard') {
    const id = payload['card_id'];
    const body = payload['description'] || "Here's the change:";
    let messageObject: IContent = {
      body: body,
      msgtype: 'org.boxel.command',
      formatted_body: body,
      format: 'org.matrix.custom.html',
      data: {
        command: {
          type: functionCall.name,
          id: id,
          //TODO: maybe this should just return the payload but it might interfere with burcus work
          patch: {
            attributes: payload['attributes'],
            relationships: payload['relationships'],
          },
          eventId: eventToUpdate,
        },
      },
    };
    return messageObject;
  } else if (functionCall.name === 'searchCard') {
    const body = payload['description'] || "Here's the query:";
    let messageObject = {
      body: body,
      msgtype: 'org.boxel.command',
      formatted_body: body,
      format: 'org.matrix.custom.html',
      data: {
        command: {
          type: functionCall.name,
          search: { ...payload },
          eventId: eventToUpdate,
        },
      },
    };
    return messageObject;
  }
  return;
};

function getErrorMessage(error: any): string {
  if (error instanceof OpenAIError) {
    return `OpenAI error: ${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return `Unknown error: ${error}`;
  }
  return `Unknown error`;
}
