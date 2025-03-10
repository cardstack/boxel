import './instrument';
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
  type PromptParts,
  constructHistory,
  isCommandResultStatusApplied,
  getPromptParts,
  extractCardFragmentsFromEvents,
  eventRequiresResponse,
} from './helpers';

import {
  shouldSetRoomTitle,
  setTitle,
  roomTitleAlreadySet,
} from './lib/set-title';
import { Responder } from './lib/responder';
import { handleDebugCommands } from './lib/debug';
import { MatrixClient } from './lib/matrix';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import * as Sentry from '@sentry/node';

import { getAvailableCredits, saveUsageCost } from './lib/ai-billing';
import { PgAdapter } from '@cardstack/postgres';
import { ChatCompletionMessageParam } from 'openai/resources';
import { OpenAIError } from 'openai/error';

let log = logger('ai-bot');

import faktory from 'faktory-worker';

let trackAiUsageCostPromises = new Map<string, Promise<void>>();

const MINIMUM_CREDITS = 10;

class Assistant {
  private openai: OpenAI;
  private client: MatrixClient;
  private toolCallCapableModels: Set<string>;
  pgAdapter: PgAdapter;
  id: string;

  constructor(client: MatrixClient, id: string) {
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    this.id = id;
    this.client = client;
    this.pgAdapter = new PgAdapter();
    this.toolCallCapableModels = new Set();
  }

  async loadToolCallCapableModels() {
    // api request is https://openrouter.ai/api/v1/models?supported_parameters=tools
    let response = await fetch(
      'https://openrouter.ai/api/v1/models?supported_parameters=tools',
    );
    let responseJson = (await response.json()) as {
      data: { id: string }[];
    };
    let modelList = responseJson.data;
    this.toolCallCapableModels = new Set(
      modelList.map((model: any) => model.id),
    );
  }

  async trackAiUsageCost(matrixUserId: string, generationId: string) {
    if (trackAiUsageCostPromises.has(matrixUserId)) {
      return;
    }
    trackAiUsageCostPromises.set(
      matrixUserId,
      saveUsageCost(this.pgAdapter, matrixUserId, generationId).finally(() => {
        trackAiUsageCostPromises.delete(matrixUserId);
      }),
    );
  }

  getResponse(prompt: PromptParts) {
    // Sending tools to models that don't support them results in an error
    // from openrouter.
    if (
      prompt.tools.length === 0 ||
      !this.toolCallCapableModels.has(prompt.model)
    ) {
      return this.openai.beta.chat.completions.stream({
        model: prompt.model,
        messages: prompt.messages as ChatCompletionMessageParam[],
      });
    } else {
      return this.openai.beta.chat.completions.stream({
        model: prompt.model,
        messages: prompt.messages as ChatCompletionMessageParam[],
        tools: prompt.tools,
        tool_choice: prompt.toolChoice,
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
  await assistant.loadToolCallCapableModels();

  const faktoryClient = await faktory.connect();

  // reuse client if possible! remember to disconnect!

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
        let senderMatrixUserId = event.getSender()!;
        if (!room) {
          return;
        }

        if (event.event.origin_server_ts! < startTime) {
          return;
        }
        if (toStartOfTimeline) {
          return; // don't print paginated results
        }
        if (!eventRequiresResponse(event)) {
          return; // only print messages
        }

        if (senderMatrixUserId === aiBotUserId) {
          return;
        }
        log.info(
          '(%s) (Room: "%s" %s) (Message: %s %s)',
          event.getType(),
          room?.name,
          room?.roomId,
          senderMatrixUserId,
          eventBody,
        );
        faktoryClient
          .job('GenerateResponse', {
            roomId: room.roomId,
            senderMatrixUserId: senderMatrixUserId,
          })
          .push();
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
    if (!isCommandResultStatusApplied(event)) {
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
      if (roomTitleAlreadySet(eventList)) {
        return;
      }
      let cardFragments = extractCardFragmentsFromEvents(eventList);
      let history: DiscreteMatrixEvent[] = constructHistory(
        eventList,
        cardFragments,
      );
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
