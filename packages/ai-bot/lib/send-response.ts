import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import { MatrixClient, sendError, sendMessage, sendOption } from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import debounce from 'lodash/debounce';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';

let log = logger('ai-bot');

export class Responder {
  // internally has a debounced function that will send the text messages

  initialMessageId: string | undefined;
  initialMessageReplaced = false;
  client: MatrixClient;
  roomId: string;
  messagePromises: Promise<ISendEventResponse | void>[] = [];
  debouncedMessageSender: (
    content: string,
    eventToUpdate: string | undefined,
    isStreamingFinished?: boolean,
  ) => Promise<void>;

  constructor(client: MatrixClient, roomId: string) {
    this.roomId = roomId;
    this.client = client;
    this.debouncedMessageSender = debounce(
      async (
        content: string,
        eventToUpdate: string | undefined,
        isStreamingFinished = false,
      ) => {
        const messagePromise = sendMessage(
          this.client,
          this.roomId,
          content,
          eventToUpdate,
          {
            isStreamingFinished: isStreamingFinished,
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
    let initialMessage = await sendMessage(
      this.client,
      this.roomId,
      'Thinking...',
      undefined,
    );
    this.initialMessageId = initialMessage.event_id;
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
    await this.debouncedMessageSender(
      cleanContent(snapshot),
      this.initialMessageId,
    );
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
    return { id, name: f.name, arguments: JSON.parse(f.arguments) };
  }

  async handleFunctionToolCalls(msg: {
    role: string;
    tool_calls?: ChatCompletionMessageToolCall[];
  }) {
    for (const toolCall of msg.tool_calls || []) {
      log.debug('[Room Timeline] Function call', toolCall);
      try {
        let optionPromise = sendOption(
          this.client,
          this.roomId,
          this.deserializeToolCall(toolCall),
          this.initialMessageReplaced ? undefined : this.initialMessageId,
        );
        this.messagePromises.push(optionPromise);
        await optionPromise;
        this.initialMessageReplaced = true;
      } catch (error) {
        Sentry.captureException(error);
        this.initialMessageReplaced = true;
        let errorPromise = sendError(
          this.client,
          this.roomId,
          error,
          this.initialMessageReplaced ? undefined : this.initialMessageId,
        );
        this.messagePromises.push(errorPromise);
        await errorPromise;
      }
    }
  }

  async onError(error: OpenAIError) {
    Sentry.captureException(error);
    return await sendError(
      this.client,
      this.roomId,
      error,
      this.initialMessageId,
    );
  }

  async finalize(finalContent: string | void | null | undefined) {
    if (finalContent) {
      finalContent = cleanContent(finalContent);
      await this.debouncedMessageSender(
        finalContent,
        this.initialMessageId,
        true,
      );
    }
    await Promise.all(this.messagePromises);
  }
}
