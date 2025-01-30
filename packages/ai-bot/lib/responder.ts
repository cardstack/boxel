import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import {
  MatrixClient,
  sendError,
  sendMessage,
  sendCommandMessage,
} from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import debounce from 'lodash/debounce';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import { thinkingMessage } from '../constants';
import { APP_BOXEL_COMMAND_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import type OpenAI from 'openai';

let log = logger('ai-bot');

export class Responder {
  // internally has a debounced function that will send the text messages

  responseEventId: string | undefined;
  initialMessageReplaced = false;
  client: MatrixClient;
  roomId: string;
  includesFunctionToolCall = false;
  latestContent = '';
  reasoning = '';
  messagePromises: Promise<ISendEventResponse | void>[] = [];
  isStreamingFinished = false;
  sendMessageDebounced: () => Promise<void>;

  constructor(client: MatrixClient, roomId: string) {
    this.roomId = roomId;
    this.client = client;
    this.sendMessageDebounced = debounce(
      async () => {
        const content = this.latestContent;
        const reasoning = this.reasoning;
        const eventToUpdate = this.responseEventId;
        const isStreamingFinished = this.isStreamingFinished;

        let dataOverrides: Record<string, string | boolean> = {
          isStreamingFinished,
        };
        if (this.includesFunctionToolCall) {
          dataOverrides = {
            ...dataOverrides,
            msgtype: APP_BOXEL_COMMAND_MSGTYPE,
          };
        }
        const messagePromise = sendMessage(
          this.client,
          this.roomId,
          content,
          reasoning,
          eventToUpdate,
          dataOverrides,
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
      thinkingMessage,
      '',
      undefined,
      { isStreamingFinished: false },
    );
    this.responseEventId = initialMessage.event_id;
  }

  async onChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk) {
    log.debug('onChunk: ', JSON.stringify(chunk, null, 2));
    if (chunk.choices[0].delta?.tool_calls?.[0]?.function) {
      if (!this.includesFunctionToolCall) {
        this.includesFunctionToolCall = true;
        await this.sendMessageDebounced();
      }
    }
    // @ts-expect-error reasoning is not in the types yet
    if (chunk.choices[0].delta?.reasoning) {
      // @ts-expect-error reasoning is not in the types yet
      this.reasoning += chunk.choices[0].delta.reasoning;
      await this.sendMessageDebounced();
    }
    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens}`,
      );
    }
  }

  async onContent(snapshot: string) {
    log.debug('onContent: ', snapshot);
    this.latestContent = cleanContent(snapshot);
    await this.sendMessageDebounced();
    this.initialMessageReplaced = true;
  }

  async onMessage(msg: {
    role: string;
    tool_calls?: ChatCompletionMessageToolCall[];
  }) {
    log.debug('onMessage: ', msg);
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
        let commandMessagePromise = sendCommandMessage(
          this.client,
          this.roomId,
          this.deserializeToolCall(toolCall),
          this.responseEventId,
        );
        this.messagePromises.push(commandMessagePromise);
        await commandMessagePromise;
        this.initialMessageReplaced = true;
      } catch (error) {
        Sentry.captureException(error);
        this.initialMessageReplaced = true;
        let errorPromise = sendError(
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
    log.debug('onError: ', error);
    Sentry.captureException(error);
    return await sendError(
      this.client,
      this.roomId,
      error,
      this.responseEventId,
    );
  }

  async finalize(finalContent: string | void | null | undefined) {
    log.debug('finalize: ', finalContent);
    if (finalContent) {
      this.latestContent = cleanContent(finalContent);
      this.isStreamingFinished = true;
      await this.sendMessageDebounced();
    }
    await Promise.all(this.messagePromises);
  }
}
