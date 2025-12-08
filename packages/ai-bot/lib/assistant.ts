import OpenAI from 'openai';
import { DEFAULT_LLM } from '@cardstack/runtime-common';
import type { PromptParts } from '@cardstack/runtime-common/ai';
import { handleDebugCommands } from './debug';
import { setTitle } from './set-title';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { saveUsageCost } from '@cardstack/billing/ai-billing';
import { PgAdapter } from '@cardstack/postgres';

const trackAiUsageCostPromises = new Map<string, Promise<void>>();

export class Assistant {
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

  async trackAiUsageCost(matrixUserId: string, generationId: string) {
    if (trackAiUsageCostPromises.has(matrixUserId)) {
      return;
    }
    // intentionally do not await saveUsageCost promise - it has a backoff mechanism to retry if the cost is not immediately available so we don't want to block the main thread
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

  getPendingUsageCostTracking(matrixUserId: string) {
    return trackAiUsageCostPromises.get(matrixUserId);
  }

  getResponse(prompt: PromptParts) {
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

    return this.openai.chat.completions.stream(request);
  }

  private getModel(prompt: PromptParts) {
    return prompt.model ?? DEFAULT_LLM;
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
