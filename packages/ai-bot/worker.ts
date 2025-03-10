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

import faktory from 'faktory-worker';

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
  faktory.register(
    'GenerateResponse',
    async ({ roomId, senderMatrixUserId }) => {
      const responder = new Responder(client, roomId);
      await responder.initialize();

      let promptParts: PromptParts;
      let initial = await client.roomInitialSync(roomId, 1000);
      let eventList = (initial!.messages?.chunk || []) as DiscreteMatrixEvent[];
      try {
        promptParts = await getPromptParts(eventList, aiBotUserId);
      } catch (e) {
        log.error(e);
        responder.finalize(
          'There was an error processing chat history. Please open another session.',
        );
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

      let availableCredits = await getAvailableCredits(
        assistant.pgAdapter,
        senderMatrixUserId,
      );

      if (availableCredits < MINIMUM_CREDITS) {
        return responder.onError(
          `You need a minimum of ${MINIMUM_CREDITS} credits to continue using the AI bot. Please upgrade to a larger plan, or top up your account.`,
        );
      }

      let generationId: string | undefined;
      const runner = assistant
        .getResponse(promptParts)
        .on('chunk', async (chunk, _snapshot) => {
          generationId = chunk.id;
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

      let finalContent;
      try {
        finalContent = await runner.finalContent();
        await responder.finalize(finalContent);
      } catch (error) {
        await responder.onError(error as OpenAIError);
      } finally {
        if (generationId) {
          assistant.trackAiUsageCost(senderMatrixUserId, generationId);
        }
      }
      return;
    },
  );

  faktory.work().catch((error) => {
    console.error(`worker failed to start: ${error}`);
    process.exit(1);
  });
})().catch((e) => {
  log.error(e);
  Sentry.captureException(e);
  process.exit(1);
});
