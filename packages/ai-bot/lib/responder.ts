import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import {
  MatrixClient,
  sendErrorEvent,
  sendMessageEvent,
  sendCommandEvent,
} from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import debounce from 'lodash/debounce';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import { thinkingMessage } from '../constants';

let log = logger('ai-bot');

export class Responder {
  // internally has a debounced function that will send the text messages

  client: MatrixClient;
  roomId: string;
  messagePromises: Promise<ISendEventResponse | void>[] = [];

  responseEventId: string | undefined;
  initialMessageReplaced = false;
  latestContent = '';
  isStreamingFinished = false;

  sendMessageEventWithDebouncing: () => Promise<void>;

  constructor(client: MatrixClient, roomId: string) {
    this.roomId = roomId;
    this.client = client;
    this.sendMessageEventWithDebouncing = debounce(
      async () => {
        const messagePromise = sendMessageEvent(
          this.client,
          this.roomId,
          this.latestContent,
          this.responseEventId,
          {
            isStreamingFinished: this.isStreamingFinished,
          },
        );
        this.messagePromises.push(messagePromise);
        await messagePromise;
      },
      250,
      { leading: true, maxWait: 250 },
    );
  }

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

  async onChunk(chunk: {
    usage?: { prompt_tokens: number; completion_tokens: number };
  }) {
    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens}`,
      );
    }
  }

  async onContent(snapshot: string) {
    this.latestContent = cleanContent(snapshot);
    await this.sendMessageEventWithDebouncing();
    this.initialMessageReplaced = true;
  }

  async onMessage(msg: {
    role: string;
    tool_calls?: ChatCompletionMessageToolCall[];
  }) {
    if (msg.role === 'assistant') {
      await this.handleFunctionToolCalls(msg);
    }
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

  async handleFunctionToolCalls(msg: {
    role: string;
    tool_calls?: ChatCompletionMessageToolCall[];
  }) {
    for (const toolCall of msg.tool_calls || []) {
      log.debug('[Room Timeline] Function call', toolCall);
      try {
        let commandEventPromise = sendCommandEvent(
          this.client,
          this.roomId,
          this.deserializeToolCall(toolCall),
          this.initialMessageReplaced ? undefined : this.responseEventId,
        );
        this.messagePromises.push(commandEventPromise);
        await commandEventPromise;
        this.initialMessageReplaced = true;
      } catch (error) {
        Sentry.captureException(error);
        this.initialMessageReplaced = true;
        let errorPromise = sendErrorEvent(
          this.client,
          this.roomId,
          error,
          this.responseEventId,
        );
        this.messagePromises.push(errorPromise);
        await errorPromise;
      }
    }
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

  async finalize(finalContent: string | void | null | undefined) {
    if (finalContent) {
      this.latestContent = cleanContent(finalContent);
      this.isStreamingFinished = true;
      await this.sendMessageEventWithDebouncing();
    }
    await Promise.all(this.messagePromises);
  }
}
