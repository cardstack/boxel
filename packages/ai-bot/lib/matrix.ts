import { IContent } from 'matrix-js-sdk';
import { logger } from '@cardstack/runtime-common';
import { OpenAIError } from 'openai/error';
import * as Sentry from '@sentry/node';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import {
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

let log = logger('ai-bot');

export interface MatrixClient {
  sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
  ): Promise<{ event_id: string }>;

  sendStateEvent(
    roomId: string,
    eventType: string,
    content: IContent,
    stateKey: string,
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

export async function updateStateEvent(
  client: MatrixClient,
  roomId: string,
  eventType: string,
  content: IContent,
) {
  return await client.sendStateEvent(roomId, eventType, content, '');
}

export async function sendMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
  reasoning: string,
  eventToUpdate: string | undefined,
  data: any = {},
) {
  log.debug('sending message', body);
  let messageObject: IContent = {
    ...{
      body,
      msgtype: 'm.text',
      formatted_body: body,
      format: 'org.matrix.custom.html',
      [APP_BOXEL_REASONING_CONTENT_KEY]: reasoning,
      'm.new_content': {
        body,
        msgtype: 'm.text',
        formatted_body: body,
        [APP_BOXEL_REASONING_CONTENT_KEY]: reasoning,
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

// TODO we might want to think about how to handle patches that are larger than
// 65KB (the maximum matrix event size), such that we split them into fragments
// like we split cards into fragments
export async function sendCommandMessage(
  client: MatrixClient,
  roomId: string,
  functionCall: FunctionToolCall,
  eventToUpdate: string | undefined,
) {
  let messageObject = toMatrixMessageCommandContent(functionCall);

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
      '',
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

export const toMatrixMessageCommandContent = (
  functionCall: FunctionToolCall,
): IContent | undefined => {
  let { arguments: payload } = functionCall;
  const body = payload['description'] || 'Issuing command';
  let messageObject: IContent = {
    body: body,
    msgtype: APP_BOXEL_COMMAND_MSGTYPE,
    formatted_body: body,
    format: 'org.matrix.custom.html',
    isStreamingFinished: true,
    data: {
      toolCall: functionCall,
    },
  };
  return messageObject;
};

function getErrorMessage(error: any): string {
  if (error instanceof OpenAIError) {
    return `OpenAI error: ${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}
