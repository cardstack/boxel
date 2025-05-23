import { setTitle } from './set-title';
import { sendErrorEvent, sendMessageEvent, MatrixClient } from './matrix/util';
import OpenAI from 'openai';

import * as Sentry from '@sentry/node';

export async function handleDebugCommands(
  openai: OpenAI,
  eventBody: string,
  client: MatrixClient,
  roomId: string,
  userId: string,
) {
  // Explicitly set the room name
  if (eventBody.startsWith('debug:title:set:')) {
    return await client.setRoomName(
      roomId,
      eventBody.split('debug:title:set:')[1],
    );
  } else if (eventBody.startsWith('debug:boom')) {
    await sendErrorEvent(
      client,
      roomId,
      `Boom! Throwing an unhandled error`,
      undefined,
    );
    throw new Error('Boom!');
  }
  // Use GPT to set the room title
  else if (eventBody.startsWith('debug:title:create')) {
    return await setTitle(openai, client, roomId, [], userId);
  } else if (eventBody.startsWith('debug:patch:')) {
    let patchMessage = eventBody.split('debug:patch:')[1];
    // If there's a card attached, we need to split it off to parse the json
    patchMessage = patchMessage.split('(Card')[0];
    let toolArguments: {
      attributes?: {
        cardId?: string;
        patch?: any;
      };
      description?: string;
    } = {};
    try {
      toolArguments = JSON.parse(patchMessage);
      if (
        !toolArguments.attributes?.cardId ||
        !toolArguments.attributes?.patch
      ) {
        throw new Error(
          'Invalid debug patch: attributes.cardId, or attributes.patch is missing.',
        );
      }
    } catch (error) {
      Sentry.captureException(error);
      return await sendMessageEvent(
        client,
        roomId,
        `Error parsing your debug patch, ${error} ${patchMessage}`,
        undefined,
        {},
        [
          {
            id: 'patchCardInstance-debug',
            name: 'patchCardInstance',
            arguments: toolArguments,
          },
        ],
      );
    }
  }
  return;
}
