import './setup-logger'; // This should be first
import {
  IContent,
  RoomMemberEvent,
  RoomEvent,
  createClient,
  ISendEventResponse,
  Room,
  MatrixClient,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import { logger, aiBotUsername } from '@cardstack/runtime-common';
import {
  constructHistory,
  getModifyPrompt,
  cleanContent,
  getFunctions,
  getStartOfConversation,
  shouldSetRoomTitle,
  type OpenAIPromptMessage,
} from './helpers';
import { OpenAIError } from 'openai/error';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
  });
}

let log = logger('ai-bot');

const openai = new OpenAI();

let startTime = Date.now();

async function sendEvent(
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
  log.info('Sending', content);
  return await client.sendEvent(room.roomId, eventType, content);
}

async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  eventToUpdate: string | undefined,
  customMessageMeta?: {},
) {
  log.info('Sending', content);
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
      ...{ customMessageMeta },
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

// TODO we might want to think about how to handle patches that are larger than
// 65KB (the maximum matrix event size), such that we split them into fragments
// like we split cards into fragments
async function sendOption(
  client: MatrixClient,
  room: Room,
  patch: any,
  eventToUpdate: string | undefined,
) {
  log.info('sending option', patch);
  const id = patch['card_id'];
  const body = patch['description'];
  let messageObject = {
    body: body,
    msgtype: 'org.boxel.command',
    formatted_body: body,
    format: 'org.matrix.custom.html',
    data: {
      command: {
        type: 'patch',
        id: id,
        patch: {
          attributes: patch['attributes'],
        },
      },
    },
  };
  log.info(JSON.stringify(messageObject, null, 2));
  return await sendEvent(
    client,
    room,
    'm.room.message',
    messageObject,
    eventToUpdate,
  );
}

function getResponse(history: DiscreteMatrixEvent[], aiBotUsername: string) {
  let functions = getFunctions(history, aiBotUsername);
  let messages = getModifyPrompt(history, aiBotUsername, functions);
  if (functions.length === 0) {
    return openai.beta.chat.completions.stream({
      model: 'gpt-4-1106-preview',
      messages: messages,
    });
  } else {
    return openai.beta.chat.completions.stream({
      model: 'gpt-4-1106-preview',
      messages: messages,
      functions: functions,
      function_call: 'auto',
    });
  }
}

async function sendError(
  client: MatrixClient,
  room: Room,
  error: any,
  eventToUpdate: string | undefined,
) {
  if (error instanceof OpenAIError) {
    log.error(`OpenAI error: ${error.name} - ${error.message}`);
  } else {
    log.error(`Unknown error: ${error}`);
  }
  try {
    await sendMessage(
      client,
      room,
      'There was an error processing your request, please try again later',
      eventToUpdate,
    );
  } catch (e) {
    // We've had a problem sending the error message back to the user
    // Log and continue
    log.error(`Error sending error message back to user: ${e}`);
    Sentry.captureException(e);
  }
}

async function setTitle(
  client: MatrixClient,
  room: Room,
  history: DiscreteMatrixEvent[],
  userId: string,
) {
  let startOfConversation = [
    {
      role: 'system',
      content: `You are a chat titling system, you must read the conversation and return a suggested title of no more than six words.
              Do NOT say talk or discussion or discussing or chat or chatting, this is implied by the context.
              Explain the general actions and user intent.`,
    } as OpenAIPromptMessage,
    ...getStartOfConversation(history, userId),
  ];
  startOfConversation.push({
    role: 'user',
    content: 'Create a short title for this chat, limited to 6 words.',
  });
  try {
    let result = await openai.chat.completions.create(
      {
        model: 'gpt-3.5-turbo-1106',
        messages: startOfConversation,
        stream: false,
      },
      {
        maxRetries: 5,
      },
    );
    let title = result.choices[0].message.content || 'no title';
    // strip leading and trailing quotes
    title = title.replace(/^"(.*)"$/, '$1');
    log.info('Setting room title to', title);
    return await client.setRoomName(room.roomId, title);
  } catch (error) {
    Sentry.captureException(error);
    return await sendError(client, room, error, undefined);
  }
}

async function handleDebugCommands(
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
    await sendMessage(client, room, `Throwing an unhandled error`, undefined);
    throw new Error('Boom');
  }
  // Use GPT to set the room title
  else if (eventBody.startsWith('debug:title:create')) {
    return await setTitle(client, room, history, userId);
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
}

(async () => {
  const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
  let client = createClient({
    baseUrl: matrixUrl,
  });
  let auth = await client
    .loginWithPassword(
      aiBotUsername,
      process.env.BOXEL_AIBOT_PASSWORD || 'pass',
    )
    .catch((e) => {
      log.error(e);
      log.info(`The matrix bot could not login to the server.
Common issues are:
- The server is not running (configured to use ${matrixUrl})
   - Check it is reachable at ${matrixUrl}/_matrix/client/versions
   - If running in development, check the docker container is running (see the boxel README)
- The bot is not registered on the matrix server
  - The bot uses the username ${aiBotUsername}
- The bot is registered but the password is incorrect
   - The bot password ${
     process.env.BOXEL_AIBOT_PASSWORD
       ? 'is set in the env var, check it is correct'
       : 'is not set in the env var so defaults to "pass"'
   }
      `);
      process.exit(1);
    });
  let { user_id: aiBotUserId } = auth;
  client.on(RoomMemberEvent.Membership, function (_event, member) {
    if (member.membership === 'invite' && member.userId === aiBotUserId) {
      client
        .joinRoom(member.roomId)
        .then(function () {
          log.info('Auto-joined %s', member.roomId);
        })
        .catch(function (err) {
          log.info(
            'Error joining this room, typically happens when a user invites then leaves before this is joined',
            err,
          );
        });
    }
  });

  // TODO: Set this up to use a queue that gets drained
  client.on(
    RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      let eventBody = event.getContent().body;
      if (!room) {
        return;
      }
      log.info('(%s) %s :: %s', room?.name, event.getSender(), eventBody);

      if (event.event.origin_server_ts! < startTime) {
        return;
      }
      if (toStartOfTimeline) {
        return; // don't print paginated results
      }
      if (event.getType() !== 'm.room.message') {
        return; // only print messages
      }
      if (event.getContent().msgtype === 'org.boxel.cardFragment') {
        return; // don't respond to card fragments, we just gather these in our history
      }
      if (event.getSender() === aiBotUserId) {
        return;
      }
      // let initialMessage: ISendEventResponse = await client.sendMessage(
      //   room!.roomId,
      //   'Thinking...',
      //   'Thinking...',
      // );

      let initialMessage = await sendMessage(
        client,
        room,
        'Thinking...',
        undefined,
        {
          isInitialMessage: true,
        },
      );

      let initial = await client.roomInitialSync(room!.roomId, 1000);
      let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
      log.info(eventList);

      log.info('Total event list', eventList.length);
      let history: DiscreteMatrixEvent[] = constructHistory(eventList);
      log.info("Compressed into just the history that's ", history.length);

      // To assist debugging, handle explicit commands
      if (eventBody.startsWith('debug:')) {
        return await handleDebugCommands(
          eventBody,
          client,
          room,
          history,
          aiBotUserId,
        );
      }

      let unsent = 0;
      let sentCommands = 0;
      const runner = getResponse(history, aiBotUserId)
        .on('content', async (_delta, snapshot) => {
          unsent += 1;
          if (unsent > 5) {
            unsent = 0;

            await sendMessage(
              client,
              room,
              cleanContent(snapshot),
              initialMessage.event_id,
            );
          }
        })
        .on('functionCall', async (functionCall) => {
          console.log('Function call', functionCall);
          let args;
          try {
            args = JSON.parse(functionCall.arguments);
          } catch (error) {
            Sentry.captureException(error);
            return await sendError(
              client,
              room,
              error,
              initialMessage.event_id,
            );
          }
          if (functionCall.name === 'patchCard') {
            sentCommands += 1;
            return await sendOption(
              client,
              room,
              args,
              initialMessage.event_id,
            );
          }
          return;
        })
        .on('error', async (error: OpenAIError) => {
          Sentry.captureException(error);
          return await sendError(client, room, error, initialMessage.event_id);
        });

      // We also need to catch the error when getting the final content
      let finalContent = await runner.finalContent().catch(async (error) => {
        return await sendError(client, room, error, initialMessage.event_id);
      });
      if (finalContent) {
        finalContent = cleanContent(finalContent);
      }
      if (finalContent) {
        await sendMessage(client, room, finalContent, initialMessage.event_id, {
          isFinalMessage: true,
        });
      }

      if (shouldSetRoomTitle(eventList, aiBotUserId, sentCommands)) {
        return await setTitle(client, room, history, aiBotUserId);
      }
      return;
    },
  );

  await client.startClient();
  log.info('client started');
})().catch((e) => {
  log.error(e);
  process.exit(1);
});
