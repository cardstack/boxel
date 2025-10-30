import { setTitle } from './set-title';
import type OpenAI from 'openai';

import * as Sentry from '@sentry/node';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import {
  getPromptParts,
  isRecognisedDebugCommand,
  sendErrorEvent,
  sendMessageEvent,
  sendPromptAsDebugMessage,
  sendEventListAsDebugMessage,
  sendDebugMessage,
} from '@cardstack/runtime-common/ai';
import type { MatrixClient } from 'matrix-js-sdk';

export async function handleDebugCommands(
  openai: OpenAI,
  eventBody: string,
  client: MatrixClient,
  roomId: string,
  userId: string,
  eventList: DiscreteMatrixEvent[],
) {
  if (eventBody.startsWith('debug:help')) {
    sendDebugMessage(
      client,
      roomId,
      `There are a few debug commands you can use:\n\n
To get the prompt sent to the AI with the last user message:\n
  debug:prompt\n
To get the prompt but with some events removed:\n
  debug:prompt:(number of events to remove)\n
To get the raw event list:\n
  debug:eventlist\n
To set the room name:\n
  debug:title:set:\n
To throw an error:\n
  debug:boom:\n
To create a new title:\n
  debug:title:create:\n
To patch a card:\n
  debug:patch:\n
      `,
    );
  }
  if (eventBody.startsWith('debug:prompt')) {
    let customMessage =
      'Add a number to remove that many user and LLM events from the event list:\n' +
      'debug:prompt:<number of events to remove>\n\n' +
      'Example: debug:prompt:3';
    if (eventBody.startsWith('debug:prompt:')) {
      let removeEventsString = eventBody.split('debug:prompt:')[1];
      let numberOfEventsToRemove = parseInt(removeEventsString) || 0;
      eventList = eventList.slice(0, -numberOfEventsToRemove);
      customMessage = `Removed ${numberOfEventsToRemove} events`;
    } else {
      // Go to the last message not from the bot
      // that is not a debug message
      let lastUserMessage = eventList.findLast(
        (event) =>
          event.sender !== userId &&
          event.type === 'm.room.message' &&
          !isRecognisedDebugCommand((event.content as any).body ?? ''),
      );
      if (lastUserMessage) {
        eventList = eventList.slice(0, eventList.indexOf(lastUserMessage) + 1);
        customMessage = `Removing events back to the last non-debug user message`;
      }
    }

    try {
      let promptParts = await getPromptParts(eventList, userId, client);
      await sendPromptAsDebugMessage(
        client,
        roomId,
        promptParts,
        customMessage,
      );
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          roomId: roomId,
          userId: userId,
          eventBody: eventBody,
          customMessage: customMessage,
        },
      });
      await sendErrorEvent(client, roomId, error, undefined);
    }
  }

  if (eventBody.startsWith('debug:eventlist')) {
    await sendEventListAsDebugMessage(client, roomId, eventList);
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
      Sentry.captureException(error, {
        extra: {
          roomId: roomId,
          userId: userId,
          patchMessage: patchMessage,
        },
      });
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
