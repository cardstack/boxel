import { setTitle } from './set-title.ts';
import type OpenAI from 'openai';

import { errorReporter } from './sentry.ts';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  constructHistory,
  getPromptParts,
  isLegacyDebugCommand,
  isRecognisedDebugCommand,
  parseFeatureCommand,
  SKILL_FEATURES,
  sessionSkillFeatures,
  sendErrorEvent,
  sendMessageEvent,
  sendPromptAsDebugMessage,
  sendEventListAsDebugMessage,
  sendDebugMessage,
} from '@cardstack/runtime-common/ai';
import type { MatrixClient } from 'matrix-js-sdk';

function helpMessage() {
  let features = Object.entries(SKILL_FEATURES)
    .map(([name, description]) => `- \`${name}\` — ${description}`)
    .join('\n');
  return `**Debug commands.** Send one as its own message. The assistant does not see it.

### Dumps
Each reply attaches a JSON file.

- \`boxel-debug:eventlist\` — every event in this room, as the model sees it: streamed messages show their final text, with edits applied and split messages joined.
- \`boxel-debug:eventlist:raw\` — every event in this room as Matrix stores it: streamed messages show their first placeholder, with the edits nested under it.
- \`boxel-debug:prompt\` — the full request the bot would send to the model for the last user message: the system prompt, skills, tools, and message history.
- \`boxel-debug:prompt:(number)\` — the same request, built as if the last (number) events had not happened.

### Features
For this room only, from the next message.

- \`boxel-debug:feature\` — list the features enabled in this room.
- \`boxel-debug:feature:enable:(name)\` — enable a feature.
- \`boxel-debug:feature:disable:(name)\` — disable a feature.

**Available features**

${features}

### Room title
- \`boxel-debug:title:set:(title)\` — set the room name.
- \`boxel-debug:title:create\` — let the AI name the room.

### Testing
- \`boxel-debug:patch:(json)\` — return a patchCardInstance tool call with this patch.
- \`boxel-debug:boom\` — throw an unhandled error.
`;
}

// The first segments of each command handled below. A command that matches
// none of them gets the help message.
const KNOWN_COMMANDS = [
  'boxel-debug:help',
  'boxel-debug:eventlist',
  'boxel-debug:prompt',
  'boxel-debug:feature',
  'boxel-debug:title',
  'boxel-debug:patch',
  'boxel-debug:boom',
];

export async function handleDebugCommands(
  openai: OpenAI,
  eventBody: string,
  client: MatrixClient,
  roomId: string,
  userId: string,
  eventList: DiscreteMatrixEvent[],
) {
  let command = eventBody.trim();
  if (isLegacyDebugCommand(command)) {
    await sendDebugMessage(
      client,
      roomId,
      `**Did you mean \`boxel-debug\`?** The debug commands now start with \`boxel-debug:\`, for example \`boxel-debug:${command.slice('debug:'.length) || 'help'}\`.\n\n${helpMessage()}`,
    );
    return;
  }
  let isKnownCommand = KNOWN_COMMANDS.some(
    (known) => command === known || command.startsWith(`${known}:`),
  );
  if (!isKnownCommand || command.startsWith('boxel-debug:help')) {
    await sendDebugMessage(client, roomId, helpMessage());
    return;
  }
  if (eventBody.startsWith('boxel-debug:prompt')) {
    let customMessage =
      'Add a number to remove that many user and LLM events from the event list:\n' +
      'boxel-debug:prompt:<number of events to remove>\n\n' +
      'Example: boxel-debug:prompt:3';
    if (eventBody.startsWith('boxel-debug:prompt:')) {
      let removeEventsString = eventBody.split('boxel-debug:prompt:')[1];
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
      errorReporter.captureException(error, {
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

  if (eventBody.startsWith('boxel-debug:feature')) {
    let command = parseFeatureCommand(eventBody);
    let features = sessionSkillFeatures(eventList, userId);
    let code = (name: string) => `\`${name}\``;
    let available = Object.keys(SKILL_FEATURES).map(code).join(', ');
    let status =
      (features.length
        ? `Features enabled in this room: ${features.map(code).join(', ')}.`
        : 'No features are enabled in this room.') +
      `\n\nAvailable features: ${available}.`;
    if (command && !(command.feature in SKILL_FEATURES)) {
      status = `There is no feature named ${code(command.feature)}.\n\n${status}`;
    } else if (command) {
      status = `**${code(command.feature)} is now ${command.enable ? 'enabled' : 'disabled'}** for this room, from your next message.\n\n${status}`;
    } else if (eventBody.trim() !== 'boxel-debug:feature') {
      status = `Use ${code('boxel-debug:feature:enable:(name)')} or ${code('boxel-debug:feature:disable:(name)')}.\n\n${status}`;
    }
    await sendDebugMessage(client, roomId, status);
  }

  if (eventBody.startsWith('boxel-debug:eventlist:raw')) {
    await sendEventListAsDebugMessage(
      client,
      roomId,
      eventList,
      'This is the raw timeline: streamed messages show their original placeholder content, not their final edits.',
    );
  } else if (eventBody.startsWith('boxel-debug:eventlist')) {
    try {
      // constructHistory mutates the events it is given; aggregate a clone so
      // the fallback below still dumps the untouched raw timeline
      let aggregatedEventList = await constructHistory(
        structuredClone(eventList),
        client,
      );
      await sendEventListAsDebugMessage(
        client,
        roomId,
        aggregatedEventList,
        'Each message shows its final content, with streaming edits applied and continuations joined. Use boxel-debug:eventlist:raw for the unaggregated timeline.',
      );
    } catch (error) {
      errorReporter.captureException(error, {
        extra: {
          roomId: roomId,
          userId: userId,
          eventBody: eventBody,
        },
      });
      await sendEventListAsDebugMessage(
        client,
        roomId,
        eventList,
        `Failed to apply streaming edits (${error}); this is the raw timeline instead.`,
      );
    }
  }
  // Explicitly set the room name
  if (eventBody.startsWith('boxel-debug:title:set:')) {
    return await client.setRoomName(
      roomId,
      eventBody.split('boxel-debug:title:set:')[1],
    );
  } else if (eventBody.startsWith('boxel-debug:boom')) {
    await sendErrorEvent(
      client,
      roomId,
      `Boom! Throwing an unhandled error`,
      undefined,
    );
    throw new Error('Boom!');
  }
  // Use GPT to set the room title
  else if (eventBody.startsWith('boxel-debug:title:create')) {
    return await setTitle(openai, client, roomId, [], userId);
  } else if (eventBody.startsWith('boxel-debug:patch:')) {
    let patchMessage = eventBody.split('boxel-debug:patch:')[1];
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
      errorReporter.captureException(error, {
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
