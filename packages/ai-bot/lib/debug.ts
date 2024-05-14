import { Room, MatrixClient } from 'matrix-js-sdk';
import { setTitle } from './set-title';
import { sendError, sendOption, sendMessage } from '../main';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';
import OpenAI from 'openai';

import * as Sentry from '@sentry/node';

export async function handleDebugCommands(
  openai: OpenAI,
  eventBody: string,
  client: MatrixClient,
  room: Room,
  history: DiscreteMatrixEvent[],
  userId: string,
) {
  // Explicitly set the room name
  if (eventBody.startsWith('debug:title:set:')) {
    return await client.setRoomName(
      room.roomId,
      eventBody.split('debug:title:set:')[1],
    );
  } else if (eventBody.startsWith('debug:boom')) {
    await sendError(
      client,
      room,
      `Boom! Throwing an unhandled error`,
      undefined,
    );
    throw new Error('Boom!');
  }
  // Use GPT to set the room title
  else if (eventBody.startsWith('debug:title:create')) {
    return await setTitle(openai, client, room, history, userId);
  } else if (eventBody.startsWith('debug:patch:')) {
    let patchMessage = eventBody.split('debug:patch:')[1];
    // If there's a card attached, we need to split it off to parse the json
    patchMessage = patchMessage.split('(Card')[0];
    let command: {
      card_id?: string;
      description?: string;
      attributes?: any;
    } = {};
    try {
      command = JSON.parse(patchMessage);
      if (!command.card_id || !command.description || !command.attributes) {
        throw new Error(
          'Invalid debug patch: card_id, description, or attributes is missing.',
        );
      }
    } catch (error) {
      Sentry.captureException(error);
      return await sendMessage(
        client,
        room,
        `Error parsing your debug patch, ${error} ${patchMessage}`,
        undefined,
      );
    }
    return await sendOption(client, room, command, undefined);
  }
  return;
}
