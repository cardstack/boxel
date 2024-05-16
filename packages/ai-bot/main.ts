import './setup-logger'; // This should be first
import {
  IContent,
  RoomMemberEvent,
  RoomEvent,
  createClient,
  Room,
  MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import { logger, aiBotUsername } from '@cardstack/runtime-common';
import {
  constructHistory,
  getModifyPrompt,
  cleanContent,
  getTools,
  isPatchReactionEvent,
} from './helpers';
import { shouldSetRoomTitle, setTitle } from './lib/set-title';
import { OpenAIError } from 'openai/error';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';
import { handleDebugCommands } from './lib/debug';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
  });
}

let log = logger('ai-bot');

class Assistant {
  private openai: OpenAI;
  private client: MatrixClient;
  id: string;

  constructor(client: MatrixClient, id: string) {
    this.openai = new OpenAI();
    this.id = id;
    this.client = client;
  }

  getResponse(history: DiscreteMatrixEvent[]) {
    let tools = getTools(history, this.id);
    let messages = getModifyPrompt(history, this.id, tools);
    if (tools.length === 0) {
      return this.openai.beta.chat.completions.stream({
        model: 'gpt-4o',
        messages: messages,
      });
    } else {
      return this.openai.beta.chat.completions.stream({
        model: 'gpt-4o',
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
      });
    }
  }

  async handleDebugCommands(
    eventBody: string,
    room: Room,
    history: DiscreteMatrixEvent[],
  ) {
    return handleDebugCommands(
      this.openai,
      eventBody,
      this.client,
      room,
      history,
      this.id,
    );
  }

  async setTitle(
    room: Room,
    history: DiscreteMatrixEvent[],
    event?: MatrixEvent,
  ) {
    return setTitle(this.openai, this.client, room, history, this.id, event);
  }
}

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

export async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  eventToUpdate: string | undefined,
  data: any = {},
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
  log.info('sending option', patch);
  const id = patch['card_id'];
  const body = patch['description'] || "Here's the change:";
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
          relationships: patch['relationships'],
        },
        eventId: eventToUpdate,
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

function getErrorMessage(error: any): string {
  if (error instanceof OpenAIError) {
    return `OpenAI error: ${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return `Unknown error: ${error}`;
  }
  return `Unknown error`;
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
  let assistant = new Assistant(client, aiBotUserId);

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
      try {
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

        let initial = await client.roomInitialSync(room!.roomId, 1000);
        let eventList = (initial!.messages?.chunk ||
          []) as DiscreteMatrixEvent[];
        log.info(eventList);

        log.info('Total event list', eventList.length);
        let history: DiscreteMatrixEvent[] = constructHistory(eventList);
        log.info("Compressed into just the history that's ", history.length);

        let initialMessage = await sendMessage(
          client,
          room,
          'Thinking...',
          undefined,
        );

        let unsent = 0;
        let thinkingMessageReplaced = false;
        const runner = assistant
          .getResponse(history)
          .on('content', async (_delta, snapshot) => {
            unsent += 1;
            if (unsent > 40) {
              unsent = 0;
              await sendMessage(
                client,
                room,
                cleanContent(snapshot),
                initialMessage.event_id,
              );
            }
            thinkingMessageReplaced = true;
          })
          // Messages can have both content and tool calls
          // We handle tool calls here
          .on('message', async (msg) => {
            if (msg.role === 'assistant') {
              for (const toolCall of msg.tool_calls || []) {
                const functionCall = toolCall.function;
                console.log('Function call', toolCall);
                let args;
                try {
                  args = JSON.parse(functionCall.arguments);
                } catch (error) {
                  Sentry.captureException(error);
                  return await sendError(
                    client,
                    room,
                    error,
                    thinkingMessageReplaced
                      ? undefined
                      : initialMessage.event_id,
                  );
                }
                if (functionCall.name === 'patchCard') {
                  await sendOption(
                    client,
                    room,
                    args,
                    thinkingMessageReplaced
                      ? undefined
                      : initialMessage.event_id,
                  );
                  thinkingMessageReplaced = true;
                }
              }
            }
          })
          .on('error', async (error: OpenAIError) => {
            Sentry.captureException(error);
            return await sendError(
              client,
              room,
              error,
              initialMessage.event_id,
            );
          });
        // We also need to catch the error when getting the final content
        let finalContent = await runner.finalContent().catch(async (error) => {
          return await sendError(client, room, error, initialMessage.event_id);
        });
        if (finalContent) {
          finalContent = cleanContent(finalContent);
          await sendMessage(
            client,
            room,
            finalContent,
            initialMessage.event_id,
            {
              isStreamingFinished: true,
            },
          );
        }

        if (shouldSetRoomTitle(eventList, aiBotUserId, event)) {
          return await assistant.setTitle(room, history, event);
        }
        return;
      } catch (e) {
        log.error(e);
        Sentry.captureException(e);
        return;
      }
    },
  );

  //handle reaction events
  client.on(RoomEvent.Timeline, async function (event, room) {
    if (event.getType() !== 'm.reaction') {
      return;
    }
    try {
      if (!room) {
        return;
      }
      let initial = await client.roomInitialSync(room!.roomId, 1000);
      let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
      let history: DiscreteMatrixEvent[] = constructHistory(eventList);
      if (isPatchReactionEvent(event)) {
        return await assistant.setTitle(room, history, event);
      }
      return;
    } catch (e) {
      log.error(e);
      Sentry.captureException(e);
      return;
    }
  });

  //handle debug events
  client.on(RoomEvent.Timeline, async function (event, room) {
    let eventBody = event.getContent().body;
    if (!eventBody.startsWith('debug:')) {
      return;
    }
    if (!room) {
      return;
    }
    //very inefficient to load initial
    let initial = await client.roomInitialSync(room!.roomId, 1000);
    let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
    let history: DiscreteMatrixEvent[] = constructHistory(eventList);
    return await assistant.handleDebugCommands(eventBody, room, history);
  });

  await client.startClient();
  log.info('client started');
})().catch((e) => {
  log.error(e);
  Sentry.captureException(e);
  process.exit(1);
});
