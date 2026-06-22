import './instrument.ts';
import './setup-logger.ts'; // This should be first
import type { MatrixEvent } from 'matrix-js-sdk';
import { RoomMemberEvent, RoomEvent, createClient } from 'matrix-js-sdk';
import {
  SlidingSync,
  type MSC3575List,
} from 'matrix-js-sdk/lib/sliding-sync.js';
import OpenAI from 'openai';
import {
  logger,
  aiBotUsername,
  DEFAULT_FALLBACK_MODEL_ID,
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
  INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT,
  SLIDING_SYNC_TIMEOUT,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import { handleDebugCommands } from './lib/debug.ts';
import { Responder } from './lib/responder.ts';
import {
  shouldSetRoomTitle,
  setTitle,
  roomTitleAlreadySet,
} from './lib/set-title.ts';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import * as Sentry from '@sentry/node';

import { spendUsageCost } from '@cardstack/billing/ai-billing';
import { PgAdapter } from '@cardstack/postgres';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { APIUserAbortError } from 'openai/error';
import type { OpenAIError } from 'openai/error';
import type { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { acquireRoomLock, releaseRoomLock } from './lib/queries.ts';
import { DebugLogger } from 'matrix-js-sdk/lib/logger.js';
import { setupSignalHandlers } from './lib/signal-handlers.ts';
import { isShuttingDown, setActiveGenerations } from './lib/shutdown.ts';
import type { MatrixClient } from 'matrix-js-sdk';
import createDebug from 'debug';
const { debug } = createDebug;
import { profEnabled, profTime, profNote } from './lib/profiler.ts';
import { publishCodePatchCorrectnessMessage } from './lib/code-patch-correctness.ts';
import {
  waitForPendingCreditTracking,
  scheduleFallbackCostTracking,
} from './lib/credit-tracking.ts';

let log = logger('ai-bot');

let trackAiUsageCostPromises = new Map<string, Promise<void>>();
let activeGenerations = new Map<
  string,
  {
    responder: Responder;
    runner: ChatCompletionStream;
    lastGeneratedChunkId: string | undefined;
    completionPromise: Promise<void>;
  }
>();

let aiBotInstanceId = uuidv4();

class Assistant {
  private openai: OpenAI;
  private client: MatrixClient;
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
    this.aiBotInstanceId = aiBotInstanceId;
  }

  getResponse(prompt: PromptParts, senderMatrixUserId?: string) {
    if (!prompt.model) {
      throw new Error('Model is required');
    }

    let request: Parameters<typeof this.openai.chat.completions.stream>[0] = {
      model: this.getModel(prompt),
      messages: prompt.messages as ChatCompletionMessageParam[],
    };

    if (prompt.reasoningEffort !== undefined) {
      request.reasoning_effort = prompt.reasoningEffort;
    }

    if (
      prompt.toolsSupported === true &&
      prompt.tools &&
      prompt.tools.length > 0
    ) {
      request.tools = prompt.tools;
      request.tool_choice = prompt.toolChoice;
    }

    if (senderMatrixUserId) {
      request.user = senderMatrixUserId;
    }

    return this.openai.chat.completions.stream(request);
  }

  getModel(prompt: PromptParts) {
    return prompt.model ?? DEFAULT_FALLBACK_MODEL_ID;
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
    senderMatrixUserId?: string,
  ) {
    return setTitle(
      this.openai,
      this.client,
      roomId,
      history,
      this.id,
      event,
      senderMatrixUserId,
    );
  }
}

let startTime = Date.now();
let assistant: Assistant;

(async () => {
  const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
  if (!process.env.OPENROUTER_API_KEY) {
    log.error('OPENROUTER_API_KEY is required.');
    process.exit(1);
  }
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

        if (
          event.getType() === 'm.room.message' &&
          event.getContent()?.msgtype ===
            APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
        ) {
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
          // Finalization, credit tracking, and cleanup are all
          // handled by the streaming code path's catch/finally
          // blocks after the APIUserAbortError is thrown.

          if (event.getType() === APP_BOXEL_STOP_GENERATING_EVENT_TYPE) {
            return; // Stop events don't need further processing
          }

          // For new messages that interrupted a generation, wait for the
          // original handler to fully clean up and release the room lock
          // before we attempt to acquire it for the new message.
          await activeGeneration.completionPromise;
        }

        if (isShuttingDown()) {
          // This aibot instance is in process of shutting down (e.g. during a new deploy, or manual termination).
          // We are shutting down gracefully (waiting for active generations to finish)
          // Do not accept new work.
          return;
        }

        // Acquire a lock so that only one instance processes events for this room at a time.
        let roomLock = await profTime(eventId, 'lock:acquire', async () =>
          acquireRoomLock(
            assistant.pgAdapter,
            room.roomId,
            aiBotInstanceId,
            eventId,
          ),
        );

        if (!roomLock) {
          // Some other instance is already processing a recent event in this room. Ignore it.
          return;
        }

        let resolveGenerationCompletion!: () => void;
        let generationCompletionPromise = new Promise<void>((resolve) => {
          resolveGenerationCompletion = resolve;
        });

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
            responder.responseState.setAllowedToolNames(
              promptParts.tools?.map((tool) => tool.function.name),
            );
            if (promptParts.pendingCodePatchCorrectnessChecks) {
              return await publishCodePatchCorrectnessMessage(
                promptParts.pendingCodePatchCorrectnessChecks,
                client,
              );
            }
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

          // Declarations that must outlive the per-user cost lock — read
          // after it releases to decide whether the fallback debit is needed.
          let chunkHandlingError: string | undefined;
          let generationId: string | undefined;
          let costInUsd: number | undefined;
          let generationCompleted = false;

          // Serialize this user's credit gate → generate → debit across all
          // rooms and replicas with the per-user cost lock (CS-11128),
          // mirroring the realm-server proxy paths. The room lock only
          // serializes per room, so without this a user firing concurrent
          // requests in N rooms passes the balance gate N times against the
          // same stale balance and overspends (CS-11504). The inline-cost
          // debit is awaited inside the lock so the next same-user request
          // cannot validate against a pre-deduction balance.
          await assistant.pgAdapter.withUserCostLock(
            senderMatrixUserId,
            async () => {
              // Do not generate new responses if previous ones' cost is still being reported
              let { error: creditTrackingError } =
                await waitForPendingCreditTracking(
                  trackAiUsageCostPromises,
                  senderMatrixUserId,
                );
              if (creditTrackingError) {
                await responder.onError(
                  'There was an error saving your Boxel credits usage. Try again or contact support if the problem persists.',
                );
                return;
              }

              const creditValidation = await profTime(
                eventId,
                'billing:validateCredits',
                async () =>
                  validateAICredits(assistant.pgAdapter, senderMatrixUserId),
              );

              if (!creditValidation.hasEnoughCredits) {
                // Careful when changing this message, it's used in the UI as a detection of whether to show the "Buy credits" button.
                await responder.onError(
                  `You need a minimum of ${MINIMUM_AI_CREDITS_TO_CONTINUE} credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.`,
                  { reloadBillingData: true },
                );
                return;
              }

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
                .getResponse(promptParts, senderMatrixUserId)
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
                  if (chunk.usage && (chunk.usage as any).cost != null) {
                    costInUsd = (chunk.usage as any).cost;
                  }
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
                    chunkHandlingError =
                      chunkProcessingResultError.errorMessage;

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
                completionPromise: generationCompletionPromise,
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
                // When the cancel handler aborts the runner,
                // finalChatCompletion() throws APIUserAbortError.
                // Finalize the responder with the canceled flag and let
                // the finally block handle credit tracking.
                if (error instanceof APIUserAbortError) {
                  log.info(`[${eventId}] Generation was canceled by user`);
                  await responder.finalize({ isCanceled: true });
                } else {
                  log.error(
                    `[${eventId}] Error during generation or finalization`,
                  );
                  log.error(error);
                  if (chunkHandlingError) {
                    await responder.onError(chunkHandlingError); // E.g. MatrixError: [413] event too large
                  } else {
                    await responder.onError(error as OpenAIError);
                  }
                }
              } finally {
                // Debit the inline cost INSIDE the lock so the next same-user
                // request observes it before validating. This path has the
                // best data (both costInUsd from inline chunks and
                // generationId). The user-facing response is already
                // finalized, so a billing-write failure here must not skip the
                // activeGenerations cleanup below (a stale entry would make a
                // later message abort an already-finished run); swallow and log
                // it, and let the next request surface any billing error via
                // validateAICredits / waitForPendingCreditTracking.
                try {
                  if (
                    typeof costInUsd === 'number' &&
                    Number.isFinite(costInUsd) &&
                    costInUsd > 0
                  ) {
                    await spendUsageCost(
                      assistant.pgAdapter,
                      senderMatrixUserId,
                      costInUsd,
                    );
                  } else if (generationId) {
                    // No inline cost: fall back to the slow generation-cost
                    // API. Register it in the tracking map here (inside the
                    // lock) so the next same-user request's
                    // waitForPendingCreditTracking observes it, but let the
                    // fetch + debit run detached — its backoff can take up to
                    // 10 minutes and must not pin the lock's connection that
                    // long.
                    scheduleFallbackCostTracking({
                      dbAdapter: assistant.pgAdapter,
                      matrixUserId: senderMatrixUserId,
                      generationId,
                      openRouterApiKey: process.env.OPENROUTER_API_KEY!,
                      trackAiUsageCostPromises,
                    });
                  } else {
                    log.warn(
                      `No usage cost and no generation ID for user ${senderMatrixUserId}, skipping credit deduction`,
                    );
                  }
                } catch (costError) {
                  log.error(`[${eventId}] Failed to record AI usage cost`);
                  log.error(costError);
                  Sentry.captureException(costError, {
                    extra: { roomId: room.roomId, eventId },
                  });
                }
                activeGenerations.delete(room.roomId);
              }

              generationCompleted = true;
            },
          );

          if (
            generationCompleted &&
            shouldSetRoomTitle(eventList, aiBotUserId, event)
          ) {
            // Intentionally do not await setTitle - let it run async so that
            // the room lock gets released asap after finalizing the response.
            // This is important because tool call results may arrive
            // immediately after responder.finalize(), and we need to make sure
            // the room lock is released.
            assistant
              .setTitle(
                room.roomId,
                promptParts.history,
                event,
                senderMatrixUserId,
              )
              .catch((error) => {
                log.error(`[${eventId}] Error setting room title`);
                log.error(error);
                Sentry.captureException(error, {
                  extra: {
                    roomId: room.roomId,
                    eventId,
                    eventType: event.getType(),
                  },
                });
              });
          }
          return;
        } finally {
          // Release the lock first, then resolve the completionPromise.
          // This ordering guarantees that any interrupted new-message
          // handler waiting on completionPromise will observe the room
          // lock as released before attempting to acquire it.
          await releaseRoomLock(assistant.pgAdapter, room.roomId);
          resolveGenerationCompletion();
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
        assistant.setTitle(
          room.roomId,
          history,
          event,
          event.getSender() ?? undefined,
        ),
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
    timeline_limit: INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT,
    required_state: [['*', '*']],
  });
  let slidingSync = new SlidingSync(
    client.baseUrl,
    lists,
    { timeline_limit: INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT },
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
