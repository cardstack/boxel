import './instrument';
import './setup-logger'; // This should be first
import {
  RoomMemberEvent,
  RoomEvent,
  createClient,
  Method,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import { logger, aiBotUsername, DEFAULT_LLM } from '@cardstack/runtime-common';
import {
  type PromptParts,
  constructHistory,
  isCommandResultStatusApplied,
  getPromptParts,
  isInDebugMode,
} from './helpers';

import {
  shouldSetRoomTitle,
  setTitle,
  roomTitleAlreadySet,
} from './lib/set-title';
import { Responder } from './lib/responder';
import { handleDebugCommands, isRecognisedDebugCommand } from './lib/debug';
import { MatrixClient, sendPromptAndEventList } from './lib/matrix';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CommandResultEvent,
} from 'https://cardstack.com/base/matrix-event';
import * as Sentry from '@sentry/node';

import { getAvailableCredits, saveUsageCost } from './lib/ai-billing';
import { PgAdapter } from '@cardstack/postgres';
import { ChatCompletionMessageParam } from 'openai/resources';
import { OpenAIError } from 'openai/error';

let log = logger('ai-bot');

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
    if (!prompt.model) {
      throw new Error('Model is required');
    }

    // Sending tools to models that don't support them results in an error
    // from openrouter.
    if (
      prompt.tools?.length === 0 ||
      (prompt.model && !this.toolCallCapableModels.has(prompt.model))
    ) {
      return this.openai.beta.chat.completions.stream({
        model: prompt.model ?? DEFAULT_LLM,
        messages: prompt.messages as ChatCompletionMessageParam[],
      });
    } else {
      return this.openai.beta.chat.completions.stream({
        model: prompt.model ?? DEFAULT_LLM,
        messages: prompt.messages as ChatCompletionMessageParam[],
        tools: prompt.tools,
        tool_choice: prompt.toolChoice,
      });
    }
  }

  async handleDebugCommands(
    eventBody: string,
    roomId: string,
    eventList: DiscreteMatrixEvent[],
  ) {
    return handleDebugCommands(
      this.openai,
      eventBody,
      this.client,
      roomId,
      this.id,
      eventList,
    );
  }

  async setTitle(
    roomId: string,
    history: DiscreteMatrixEvent[],
    event?: CommandResultEvent,
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

  client.on(RoomMemberEvent.Membership, function (event, member) {
    if (event.event.origin_server_ts! < startTime) {
      return;
    }
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

  // TODO: Set this up to use a queue that gets drained (CS-8516)
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

        if (senderMatrixUserId === aiBotUserId) {
          return;
        }

        if (!Responder.eventMayTriggerResponse(event)) {
          return; // early exit for events that will not trigger a response
        }

        log.info(
          '(%s) (Room: "%s" %s) (Message: %s %s)',
          event.getType(),
          room?.name,
          room?.roomId,
          senderMatrixUserId,
          eventBody,
        );

        const responder = new Responder(client, room.roomId);

        if (Responder.eventWillDefinitelyTriggerResponse(event)) {
          await responder.ensureThinkingMessageSent();
        }

        let promptParts: PromptParts;
        let initial = await client.roomInitialSync(room!.roomId, 1000);
        let eventList = (initial!.messages?.chunk ||
          []) as DiscreteMatrixEvent[];
        try {
          promptParts = await getPromptParts(eventList, aiBotUserId, client);
          if (!promptParts.shouldRespond) {
            return;
          }
          // if debug, send message with promptParts and event list
          if (isInDebugMode(eventList, aiBotUserId)) {
            // create files in memory
            sendPromptAndEventList(client, room.roomId, promptParts, eventList);
          }
          await responder.ensureThinkingMessageSent();
        } catch (e) {
          log.error(e);
          await responder.onError(
            new Error(
              'There was an error processing chat history. Please open another session.',
            ),
          );
          await responder.finalize();
          return;
        }

        // Do not generate new responses if previous ones' cost is still being reported
        let pendingCreditsConsumptionPromise = trackAiUsageCostPromises.get(
          senderMatrixUserId!,
        );
        if (pendingCreditsConsumptionPromise) {
          try {
            await pendingCreditsConsumptionPromise;
          } catch (e) {
            log.error(e);
            return responder.onError(
              'There was an error saving your Boxel credits usage. Try again or contact support if the problem persists.',
            );
          }
        }

        let availableCredits = 1000;
        if (availableCredits < MINIMUM_CREDITS) {
          return responder.onError(
            `You need a minimum of ${MINIMUM_CREDITS} credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.`,
          );
        }

        let chunkHandlingError: string | undefined;
        let generationId: string | undefined;
        const runner = assistant
          .getResponse(promptParts)
          .on('chunk', async (chunk, snapshot) => {
            generationId = chunk.id;

            let chunkProcessingResult = await responder.onChunk(
              chunk,
              snapshot,
            );
            let chunkProcessingResultError = chunkProcessingResult.find(
              (promiseResult) =>
                promiseResult &&
                'errorMessage' in promiseResult &&
                promiseResult.errorMessage != null,
            ) as { errorMessage: string } | undefined;

            if (chunkProcessingResultError) {
              chunkHandlingError = chunkProcessingResultError.errorMessage;

              // If there was an error processing the chunk, e.g. matrix sending error (e.g. event too large),
              // then we want to stop accepting more chunks by aborting the runner. This will throw an error
              // where the await responder.finalize() is called (the catch block below will handle this)
              runner.abort();
            }
          })
          .on('error', async (error) => {
            await responder.onError(error);
          });

        try {
          await runner.finalChatCompletion();
          await responder.finalize();
        } catch (error) {
          if (chunkHandlingError) {
            await responder.onError(chunkHandlingError); // E.g. MatrixError: [413] event too large
          } else {
            await responder.onError(error as OpenAIError);
          }
        } finally {
          if (generationId) {
            assistant.trackAiUsageCost(senderMatrixUserId, generationId);
          }
        }

        if (shouldSetRoomTitle(eventList, aiBotUserId, event)) {
          return await assistant.setTitle(
            room.roomId,
            promptParts.history,
            event as unknown as CommandResultEvent,
          );
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
    if (
      event.event.origin_server_ts! < startTime ||
      !room ||
      !isCommandResultStatusApplied(event)
    ) {
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
      let history: DiscreteMatrixEvent[] = await constructHistory(
        eventList,
        client,
      );
      return await assistant.setTitle(
        room.roomId,
        history,
        event as unknown as CommandResultEvent,
      );
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
    if (event.getSender() == aiBotUserId) {
      return;
    }
    if (!room) {
      return;
    }
    let eventBody = event.getContent().body;
    let isDebugEvent = isRecognisedDebugCommand(eventBody);
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
    let initial = await client.roomInitialSync(room!.roomId, 1000);
    let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
    return await assistant.handleDebugCommands(
      eventBody,
      room.roomId,
      eventList,
    );
  });

  await client.startClient();
  log.info('client started');
})().catch((e) => {
  log.error(e);
  Sentry.captureException(e);
  process.exit(1);
});
