import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import throttle from 'lodash/throttle';
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
  needsMessageSend = false;

  sendMessageEventWithThrottling = () => {
    this.needsMessageSend = true;
    this.sendMessageEventWithThrottlingInternal();
  };

  sendMessageEventWithThrottlingInternal: () => unknown = throttle(() => {
    this.needsMessageSend = false;
    this.sendMessageEvent();
  }, 250);

  sendMessageEvent = async () => {
    const messagePromise = sendMessageEvent(
      this.client,
      this.roomId,
      this.latestContent,
      this.responseEventId,
      {
        isStreamingFinished: this.isStreamingFinished,
      },
      this.toolCalls.map((toolCall) =>
        this.toCommandRequest(toolCall as ChatCompletionMessageToolCall),
      ),
    );
    this.messagePromises.push(messagePromise);
    await messagePromise;
  };

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
        await this.sendMessageEventWithThrottling();
      }
    }

    let contentSnapshot = snapshot.choices[0].message.content;
    if (contentSnapshot?.length) {
      contentSnapshot = cleanContent(contentSnapshot);
      if (this.latestContent !== contentSnapshot) {
        this.latestContent = contentSnapshot;
        await this.sendMessageEventWithThrottling();
      }
    }

    if (snapshot.choices[0].finish_reason === 'stop') {
      if (!this.isStreamingFinished) {
        this.isStreamingFinished = true;
        await this.sendMessageEventWithThrottling();
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
  ): Partial<CommandRequestContent> {
    let { id, function: f } = toolCall;
    let result = {} as Partial<CommandRequestContent>;
    if (id) {
      result['id'] = id;
    }
    if (f.name) {
      result['name'] = f.name;
    }
    if (f.arguments) {
      result['arguments'] = JSON.parse(f.arguments);
    }
    return result;
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

  async flush() {
    if (this.needsMessageSend) {
      (
        this.sendMessageEventWithThrottlingInternal as unknown as {
          cancel: () => void;
        }
      ).cancel();
      this.sendMessageEvent();
    }
    await Promise.all(this.messagePromises);
  }

  async finalize() {
    await this.flush();
  }
}
