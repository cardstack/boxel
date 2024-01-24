import './setup-logger'; // This should be first
import {
  IContent,
  RoomMemberEvent,
  RoomEvent,
  createClient,
  ISendEventResponse,
  Room,
  MatrixClient,
  IRoomEvent,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import {
  logger,
  aiBotUsername,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  constructHistory,
  getModifyPrompt,
  cleanContent,
  getFunctions,
} from './helpers';
import { OpenAIError } from 'openai/error';

let log = logger('ai-bot');

const openai = new OpenAI();

let startTime = Date.now();

async function sendEvent(
  client: MatrixClient,
  room: Room,
  eventType: string,
  content: any,
) {
  if (content.data) {
    content.data = JSON.stringify(content.data);
  }
  log.info('Sending', content);
  return await client.sendEvent(room.roomId, eventType, content);
}

async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  previous: string | undefined,
) {
  log.info('Sending', content);
  let messageObject: IContent = {
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
  };
  if (previous) {
    messageObject['m.relates_to'] = {
      rel_type: 'm.replace',
      event_id: previous,
    };
  }
  return await sendEvent(client, room, 'm.room.message', messageObject);
}

async function sendOption(client: MatrixClient, room: Room, patch: any) {
  log.info('sending option', patch);
  let id = patch['card_id'];
  let messageObject = {
    body: 'patch',
    msgtype: 'org.boxel.command',
    formatted_body: 'A patch',
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
  return await sendEvent(client, room, 'm.room.message', messageObject);
}

function getLastUploadedCardID(history: IRoomEvent[]): string | undefined {
  for (let event of history.slice().reverse()) {
    if (event.content.msgtype === 'org.boxel.card') {
      const cardInstances: LooseSingleCardDocument[] =
        event.content.data.instances;
      return cardInstances[0].data.id;
    }
  }
  return undefined;
}

function getResponse(history: IRoomEvent[], aiBotUsername: string) {
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
  let { user_id: userId } = auth;
  client.on(RoomMemberEvent.Membership, function (_event, member) {
    if (member.membership === 'invite' && member.userId === userId) {
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
      if (!room) {
        return;
      }
      log.info(
        '(%s) %s :: %s',
        room?.name,
        event.getSender(),
        event.getContent().body,
      );

      if (event.event.origin_server_ts! < startTime) {
        return;
      }
      if (toStartOfTimeline) {
        return; // don't print paginated results
      }
      if (event.getType() !== 'm.room.message') {
        return; // only print messages
      }
      if (event.getSender() === userId) {
        return;
      }
      let initialMessage: ISendEventResponse = await client.sendHtmlMessage(
        room!.roomId,
        'Thinking...',
        'Thinking...',
      );

      let initial = await client.roomInitialSync(room!.roomId, 1000);
      let eventList = initial!.messages?.chunk || [];
      log.info(eventList);

      log.info('Total event list', eventList.length);
      let history: IRoomEvent[] = constructHistory(eventList);
      log.info("Compressed into just the history that's ", history.length);

      // While developing the frontend it can be handy to skip GPT and just return some data
      if (event.getContent().body.startsWith('debugpatch:')) {
        let body = event.getContent().body;
        let patchMessage = body.split('debugpatch:')[1];
        // If there's a card attached, we need to split it off to parse the json
        patchMessage = patchMessage.split('(Card')[0];
        let attributes = {};
        try {
          attributes = JSON.parse(patchMessage);
        } catch (error) {
          await sendMessage(
            client,
            room,
            'Error parsing your debug patch as JSON: ' + patchMessage,
            initialMessage.event_id,
          );
        }
        let command = {
          type: 'patch',
          id: getLastUploadedCardID(history),
          patch: {
            attributes: attributes,
          },
        };
        return await sendOption(client, room, command);
      }

      let unsent = 0;
      const runner = getResponse(history, userId)
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
            return await sendError(
              client,
              room,
              error,
              initialMessage.event_id,
            );
          }
          if (functionCall.name === 'patchCard') {
            await sendMessage(
              client,
              room,
              args.description,
              initialMessage.event_id,
            );
            return await sendOption(client, room, args);
          }
          return;
        })
        .on('error', async (error: OpenAIError) => {
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
        await sendMessage(client, room, finalContent, initialMessage.event_id);
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
