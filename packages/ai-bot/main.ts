import './instrument';
import './setup-logger'; // This should be first
import type { MatrixEvent } from 'matrix-js-sdk';
import { RoomMemberEvent, RoomEvent, createClient } from 'matrix-js-sdk';
import { SlidingSync, type MSC3575List } from 'matrix-js-sdk/lib/sliding-sync';
import OpenAI from 'openai';
import {
  logger,
  aiBotUsername,
  DEFAULT_LLM,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  uuidv4,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
} from '@cardstack/runtime-common';
import type { PromptParts } from '@cardstack/runtime-common/ai';
import {
  isRecognisedDebugCommand,
  getPromptParts,
  isInDebugMode,
  isCommandResultStatusApplied,
  getRoomEvents,
  sendPromptAsDebugMessage,
  constructHistory,
} from '@cardstack/runtime-common/ai';
import { validateAICredits } from '@cardstack/billing/ai-billing';
import {
  SLIDING_SYNC_AI_ROOM_LIST_NAME,
  SLIDING_SYNC_LIST_TIMELINE_LIMIT,
  SLIDING_SYNC_TIMEOUT,
} from '@cardstack/runtime-common/matrix-constants';

import { handleDebugCommands } from './lib/debug';
import { Responder } from './lib/responder';
import {
  shouldSetRoomTitle,
  setTitle,
  roomTitleAlreadySet,
} from './lib/set-title';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import * as Sentry from '@sentry/node';

import { saveUsageCost } from '@cardstack/billing/ai-billing';
import { PgAdapter } from '@cardstack/postgres';
import type { ChatCompletionMessageParam } from 'openai/resources';
import type { OpenAIError } from 'openai/error';
import type { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { acquireLock, releaseLock } from './lib/queries';
import { DebugLogger } from 'matrix-js-sdk/lib/logger';
import { setupSignalHandlers } from './lib/signal-handlers';
import { isShuttingDown, setActiveGenerations } from './lib/shutdown';
import type { MatrixClient } from 'matrix-js-sdk';
import { debug } from 'debug';
import { profEnabled, profTime, profNote } from './lib/profiler';

let log = logger('ai-bot');

let trackAiUsageCostPromises = new Map<string, Promise<void>>();
let activeGenerations = new Map<
  string,
  {
    responder: Responder;
    runner: ChatCompletionStream;
    lastGeneratedChunkId: string | undefined;
  }
>();

let aiBotInstanceId = uuidv4();

class Assistant {
  private openai: OpenAI;
  private client: MatrixClient;
  private toolCallCapableModels: Set<string>;
  pgAdapter: PgAdapter;
  id: string;
  aiBotInstanceId: string;

  constructor(client: MatrixClient, id: string, aiBotInstanceId: string) {
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    this.id = id;
    this.client = client;
    this.pgAdapter = new PgAdapter();
    this.toolCallCapableModels = new Set();
    this.aiBotInstanceId = aiBotInstanceId;
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
      saveUsageCost(
        this.pgAdapter,
        matrixUserId,
        generationId,
        process.env.OPENROUTER_API_KEY!,
      ).finally(() => {
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
      return this.openai.chat.completions.stream({
        model: this.getModel(prompt),
        messages: prompt.messages as ChatCompletionMessageParam[],
        reasoning_effort: this.getReasoningEffort(prompt),
      });
    } else {
      return this.openai.chat.completions.stream({
        model: this.getModel(prompt),
        messages: prompt.messages as ChatCompletionMessageParam[],
        tools: prompt.tools,
        tool_choice: prompt.toolChoice,
        reasoning_effort: this.getReasoningEffort(prompt),
      });
    }
  }

  getModel(prompt: PromptParts) {
    return prompt.model ?? DEFAULT_LLM;
  }

  // TODO: This function is used to avoid a thinking model of gpt-5.
  // This should use the reasoning effort defined in the ModelConfiguration card instead.
  // once this is supported.
  getReasoningEffort(prompt: PromptParts) {
    let model = this.getModel(prompt);
    return model === 'openai/gpt-5' ? 'minimal' : undefined;
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
    event?: MatrixEvent,
  ) {
    return setTitle(this.openai, this.client, roomId, history, this.id, event);
  }
}

let startTime = Date.now();
let assistant: Assistant;

(async () => {
  const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
  let matrixDebugLogger = !process.env.DISABLE_MATRIX_JS_LOGGING
    ? new DebugLogger(debug(`matrix-js-sdk:${aiBotUsername}`))
    : undefined;
  let client = createClient({
    baseUrl: matrixUrl,
    logger: matrixDebugLogger,
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

  assistant = new Assistant(client, aiBotUserId, aiBotInstanceId);
  await assistant.loadToolCallCapableModels();

  // Set up signal handlers for graceful shutdown
  setupSignalHandlers();

  // Share activeGenerations map with shutdown module
  setActiveGenerations(activeGenerations);

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
      let eventId = event.getId()!;

      try {
        // Ensure that the event body we have is a string
        // it's possible that this is sent undefined
        let eventBody = event.getContent().body || '';
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

        if (profEnabled()) {
          profNote(eventId, 'event:received', {
            type: event.getType(),
            ts: event.event.origin_server_ts,
          });
        }

        // Handle the case where the user stops the generation
        let activeGeneration = activeGenerations.get(room.roomId);
        if (
          activeGeneration &&
          (event.getType() === APP_BOXEL_STOP_GENERATING_EVENT_TYPE ||
            event.getType() === 'm.room.message')
        ) {
          activeGeneration.runner.abort();
          await activeGeneration.responder.finalize({
            isCanceled: true,
          });
          if (activeGeneration.lastGeneratedChunkId) {
            await assistant.trackAiUsageCost(
              senderMatrixUserId,
              activeGeneration.lastGeneratedChunkId,
            );
          }
          activeGenerations.delete(room.roomId);
        }

        if (isShuttingDown()) {
          // This aibot instance is in process of shutting down (e.g. during a new deploy, or manual termination).
          // We are shutting down gracefully (waiting for active generations to finish)
          // Do not accept new work.
          return;
        }

        // Acquire a lock so that only one instance processes this event.
        let eventLock = await profTime(eventId, 'lock:acquire', async () =>
          acquireLock(assistant.pgAdapter, eventId, aiBotInstanceId),
        );

        if (!eventLock) {
          // Some other instance is already processing this event. Ignore it.
          return;
        }

        try {
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

          let promptParts: PromptParts;
          let eventList: DiscreteMatrixEvent[];
          try {
            eventList = await profTime(
              eventId,
              'history:getRoomEvents',
              async () => getRoomEvents(room.roomId, client, event.getId()),
            );
          } catch (e) {
            log.error(e);
            Sentry.captureException(e, {
              extra: {
                roomId: room.roomId,
                eventId: eventId,
                eventBody: eventBody,
                senderMatrixUserId: senderMatrixUserId,
              },
            });
            return;
          }

          // Return early here if it's a debug event
          if (isRecognisedDebugCommand(eventBody)) {
            return await assistant.handleDebugCommands(
              eventBody,
              room.roomId,
              eventList,
            );
          }

          let contentData =
            typeof event.getContent().data === 'string'
              ? JSON.parse(event.getContent().data)
              : event.getContent().data;
          const agentId = contentData.context?.agentId;
          const responder = new Responder(client, room.roomId, agentId);

          if (Responder.eventWillDefinitelyTriggerResponse(event)) {
            await responder.ensureThinkingMessageSent();
          }

          try {
            promptParts = await profTime(
              eventId,
              'history:constructPromptParts',
              async () => getPromptParts(eventList, aiBotUserId, client),
            );
            if (!promptParts.shouldRespond) {
              return;
            }
            // if debug, send message with promptParts and event list
            if (isInDebugMode(eventList, aiBotUserId)) {
              // create files in memory
              sendPromptAsDebugMessage(client, room.roomId, promptParts);
            }
            await responder.ensureThinkingMessageSent();
          } catch (e) {
            log.error(e);
            Sentry.captureException(e, {
              extra: {
                roomId: room.roomId,
                eventId: eventId,
                eventBody: eventBody,
                senderMatrixUserId: senderMatrixUserId,
              },
            });
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

          const creditValidation = await profTime(
            eventId,
            'billing:validateCredits',
            async () =>
              validateAICredits(assistant.pgAdapter, senderMatrixUserId),
          );

          if (!creditValidation.hasEnoughCredits) {
            // Careful when changing this message, it's used in the UI as a detection of whether to show the "Buy credits" button.
            return responder.onError(
              `You need a minimum of ${MINIMUM_AI_CREDITS_TO_CONTINUE} credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.`,
            );
          }

          let chunkHandlingError: string | undefined;
          let generationId: string | undefined;
          log.info(
            `[${eventId}] Starting generation with model %s`,
            promptParts.model,
          );
          const requestStart = Date.now();
          let firstChunkAt: number | undefined;
          if (profEnabled()) {
            profNote(eventId, 'llm:request:start', {
              model: promptParts.model,
            });
          }
          const runner = assistant
            .getResponse(promptParts)
            .on('chunk', async (chunk, snapshot) => {
              log.info(`[${eventId}] Received chunk %s`, chunk.id);
              if (profEnabled() && firstChunkAt == null) {
                firstChunkAt = Date.now();
                profNote(eventId, 'llm:ttft', {
                  ms: firstChunkAt - requestStart,
                  model: promptParts.model,
                });
              }
              generationId = chunk.id;
              let activeGeneration = activeGenerations.get(room.roomId);
              if (activeGeneration) {
                activeGeneration.lastGeneratedChunkId = generationId;
              }

              let chunkProcessingResult = await profTime(
                eventId,
                'llm:chunk:onChunk',
                async () => responder.onChunk(chunk, snapshot),
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

          activeGenerations.set(room.roomId, {
            responder,
            runner,
            lastGeneratedChunkId: generationId,
          });

          try {
            await profTime(eventId, 'llm:finalChatCompletion', async () =>
              runner.finalChatCompletion(),
            );
            log.info(`[${eventId}] Generation complete`);
            await profTime(eventId, 'response:finalize', async () =>
              responder.finalize(),
            );
            log.info(`[${eventId}] Response finalized`);
          } catch (error) {
            log.error(`[${eventId}] Error during generation or finalization`);
            log.error(error);
            if (chunkHandlingError) {
              await responder.onError(chunkHandlingError); // E.g. MatrixError: [413] event too large
            } else {
              await responder.onError(error as OpenAIError);
            }
          } finally {
            if (generationId) {
              assistant.trackAiUsageCost(senderMatrixUserId, generationId);
            }
            activeGenerations.delete(room.roomId);
          }

          if (shouldSetRoomTitle(eventList, aiBotUserId, event)) {
            return await assistant.setTitle(
              room.roomId,
              promptParts.history,
              event,
            );
          }
          return;
        } finally {
          await releaseLock(assistant.pgAdapter, eventId);
        }
      } catch (e) {
        log.error(e);
        Sentry.captureException(e, {
          extra: {
            roomId: room?.roomId,
            eventId: event.getId(),
            eventType: event.getType(),
          },
        });
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
      let eventList = await profTime(
        event.getId()!,
        'title:getRoomEvents',
        async () => getRoomEvents(room.roomId, client, event.getId()),
      );
      if (roomTitleAlreadySet(eventList)) {
        return;
      }
      let history: DiscreteMatrixEvent[] = await profTime(
        event.getId()!,
        'title:constructHistory',
        async () => constructHistory(eventList, client),
      );
      return await profTime(event.getId()!, 'title:setTitle', async () =>
        assistant.setTitle(room.roomId, history, event),
      );
    } catch (e) {
      log.error(e);
      Sentry.captureException(e, {
        extra: {
          roomId: room?.roomId,
          eventId: event.getId(),
          eventType: event.getType(),
        },
      });
      return;
    }
  });

  let lists: Map<string, MSC3575List> = new Map();
  lists.set(SLIDING_SYNC_AI_ROOM_LIST_NAME, {
    ranges: [[0, 0]],
    filters: {
      is_dm: false,
    },
    timeline_limit: SLIDING_SYNC_LIST_TIMELINE_LIMIT,
    required_state: [['*', '*']],
  });
  let slidingSync = new SlidingSync(
    client.baseUrl,
    lists,
    { timeline_limit: SLIDING_SYNC_LIST_TIMELINE_LIMIT },
    client,
    SLIDING_SYNC_TIMEOUT,
  );
  await client.startClient({
    slidingSync,
  });
  log.info('client started');
})().catch((e) => {
  log.error(e);
  Sentry.captureException(e, {
    extra: {
      aiBotInstanceId: aiBotInstanceId,
    },
  });
  process.exit(1);
});
