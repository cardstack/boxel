import './setup-logger'; // This should be first
import {
  RoomMemberEvent,
  RoomEvent,
  createClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import { logger, aiBotUsername } from '@cardstack/runtime-common';
import {
  constructHistory,
  getModifyPrompt,
  getTools,
  isCommandReactionEvent,
} from './helpers';
import {
  shouldSetRoomTitle,
  setTitle,
  roomTitleAlreadySet,
} from './lib/set-title';
import { Responder } from './lib/send-response';
import { handleDebugCommands } from './lib/debug';
import { MatrixClient } from './lib/matrix';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
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

  async handleDebugCommands(eventBody: string, roomId: string) {
    return handleDebugCommands(
      this.openai,
      eventBody,
      this.client,
      roomId,
      this.id,
    );
  }

  async setTitle(
    roomId: string,
    history: DiscreteMatrixEvent[],
    event?: MatrixEvent,
  ) {
    return setTitle(this.openai, this.client, roomId, history, this.id, event);
  }
}

let startTime = Date.now();

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
          log.info('%s auto-joined %s', member.name, member.roomId);
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

        if (event.getContent().msgtype === 'org.boxel.commandResult') {
          return; //don't responsd to command results
        }
        if (event.getSender() === aiBotUserId) {
          return;
        }
        log.info(
          '(%s) (Room: "%s" %s) (Message: %s %s)',
          event.getType(),
          room?.name,
          room?.roomId,
          event.getSender(),
          eventBody,
        );

        let initial = await client.roomInitialSync(room!.roomId, 1000);
        let eventList = (initial!.messages?.chunk ||
          []) as DiscreteMatrixEvent[];
        log.info('Total event list', eventList.length);
        let history: DiscreteMatrixEvent[] = constructHistory(eventList);
        log.info("Compressed into just the history that's ", history.length);

        const responder = new Responder(client, room.roomId);
        await responder.initialize();
        const runner = assistant
          .getResponse(history)
          .on('chunk', async (chunk, _snapshot) => {
            await responder.onChunk(chunk);
          })
          .on('content', async (_delta, snapshot) => {
            await responder.onContent(snapshot);
          })
          .on('message', async (msg) => {
            await responder.onMessage(msg);
          })
          .on('error', async (error) => {
            await responder.onError(error);
          });
        // We also need to catch the error when getting the final content
        let finalContent = await runner.finalContent().catch(responder.onError);
        await responder.finalize(finalContent);

        if (shouldSetRoomTitle(eventList, aiBotUserId, event)) {
          return await assistant.setTitle(room.roomId, history, event);
        }
        return;
      } catch (e) {
        log.error(e);
        Sentry.captureException(e);
        return;
      }
    },
  );

  //handle set title by commands
  client.on(RoomEvent.Timeline, async function (event, room) {
    if (!room) {
      return;
    }
    if (!isCommandReactionEvent(event)) {
      return;
    }
    log.info(
      '(%s) (Room: "%s" %s) (Message: %s %s)',
      event.getType(),
      room?.name,
      room?.roomId,
      event.getSender(),
      undefined,
    );
    try {
      //TODO: optimise this so we don't need to sync room events within a reaction event
      let initial = await client.roomInitialSync(room!.roomId, 1000);
      let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
      let history: DiscreteMatrixEvent[] = constructHistory(eventList);
      if (roomTitleAlreadySet(eventList)) {
        return;
      }
      return await assistant.setTitle(room.roomId, history, event);
    } catch (e) {
      log.error(e);
      Sentry.captureException(e);
      return;
    }
  });

  //handle debug events
  client.on(RoomEvent.Timeline, async function (event, room) {
    if (event.event.origin_server_ts! < startTime) {
      return;
    }
    if (event.getType() !== 'm.room.message') {
      return;
    }
    if (!room) {
      return;
    }
    let eventBody = event.getContent().body;
    let isDebugEvent = eventBody.startsWith('debug:');
    if (!isDebugEvent) {
      return;
    }
    log.info(
      '(%s) (Room: "%s" %s) (Message: %s %s)',
      event.getType(),
      room?.name,
      room?.roomId,
      event.getSender(),
      eventBody,
    );
    return await assistant.handleDebugCommands(eventBody, room.roomId);
  });

  await client.startClient();
  log.info('client started');
})().catch((e) => {
  log.error(e);
  Sentry.captureException(e);
  process.exit(1);
});
