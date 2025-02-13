import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import debounce from 'lodash/debounce';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import {
  CommandRequestContent,
  FunctionToolCall,
} from '@cardstack/runtime-common/helpers/ai';
import { thinkingMessage } from '../constants';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';

let log = logger('ai-bot');

export class Responder {
  // internally has a debounced function that will send the matrix messages

  constructor(
    readonly client: MatrixClient,
    readonly roomId: string,
  ) {}

  messagePromises: Promise<ISendEventResponse | void>[] = [];

  responseEventId: string | undefined;
  latestContent = '';
  toolCalls: ChatCompletionSnapshot.Choice.Message.ToolCall[] = [];
  isStreamingFinished = false;

  sendMessageEventWithDebouncing: () => Promise<void> = debounce(
    async () => {
      const messagePromise = sendMessageEvent(
        this.client,
        this.roomId,
        this.latestContent,
        this.responseEventId,
        {
          isStreamingFinished: this.isStreamingFinished,
        },
        this.toolCalls.map((toolCall) => this.toCommandRequest(toolCall)),
      );
      this.messagePromises.push(messagePromise);
      await messagePromise;
    },
    250,
    { leading: true, maxWait: 250 },
  );

  async initialize() {
    let initialMessage = await sendMessageEvent(
      this.client,
      this.roomId,
      thinkingMessage,
      undefined,
      { isStreamingFinished: false },
    );
    this.responseEventId = initialMessage.event_id;
  }

  async onChunk(
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    snapshot: ChatCompletionSnapshot,
  ) {
    const toolCallsSnapshot = snapshot.choices[0].message.tool_calls;
    if (toolCallsSnapshot?.length) {
      if (
        JSON.stringify(this.toolCalls) !== JSON.stringify(toolCallsSnapshot)
      ) {
        this.toolCalls = toolCallsSnapshot;
        await this.sendMessageEventWithDebouncing();
      }
    }

    let contentSnapshot = snapshot.choices[0].message.content;
    if (contentSnapshot?.length) {
      contentSnapshot = cleanContent(contentSnapshot);
      if (this.latestContent !== contentSnapshot) {
        this.latestContent = contentSnapshot;
        await this.sendMessageEventWithDebouncing();
      }
    }

    if (snapshot.choices[0].finish_reason === 'stop') {
      if (!this.isStreamingFinished) {
        this.isStreamingFinished = true;
        await this.sendMessageEventWithDebouncing();
      }
    }

    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens}`,
      );
    }

    await Promise.all(this.messagePromises);
  }

  deserializeToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): FunctionToolCall {
    let { id, function: f } = toolCall;
    return {
      type: 'function',
      id,
      name: f.name,
      arguments: JSON.parse(f.arguments),
    };
  }

  toCommandRequest(
    toolCall: ChatCompletionMessageToolCall,
  ): CommandRequestContent {
    let { id, function: f } = toolCall;
    return {
      id,
      name: f.name,
      arguments: JSON.parse(f.arguments),
    };
  }

  async onError(error: OpenAIError | string) {
    Sentry.captureException(error);
    return await sendErrorEvent(
      this.client,
      this.roomId,
      error,
      this.responseEventId,
    );
  }

  async finalize() {
    await Promise.all(this.messagePromises);
  }
}
