import { setTitle } from './set-title';
import {
  sendErrorEvent,
  sendMessageEvent,
  sendPromptAndEventList,
  MatrixClient,
} from './matrix';
import OpenAI from 'openai';

import * as Sentry from '@sentry/node';
import { getPromptParts } from '../helpers';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

export function isRecognisedDebugCommand(eventBody: string) {
  return (
    eventBody.startsWith('debug:promptandevents') ||
    eventBody.startsWith('debug:title:') ||
    eventBody.startsWith('debug:boom') ||
    eventBody.startsWith('debug:patch:')
  );
}

export async function handleDebugCommands(
  openai: OpenAI,
  eventBody: string,
  client: MatrixClient,
  roomId: string,
  userId: string,
  eventList: DiscreteMatrixEvent[],
) {
  if (eventBody.startsWith('debug:promptandevents')) {
    let promptParts = await getPromptParts(
      eventList.slice(0, -1),
      userId,
      client,
    );
    sendPromptAndEventList(client, roomId, promptParts, eventList);
  }
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
