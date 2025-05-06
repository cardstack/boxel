import { logger } from '@cardstack/runtime-common';
import type { MatrixClient } from './matrix/util';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import throttle from 'lodash/throttle';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import {
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import { MatrixEvent as DiscreteMatrixEvent } from 'matrix-js-sdk';
import MatrixResponsePublisher from './matrix/response-publisher';
import ResponseState from './response-state';

let log = logger('ai-bot');

export class Responder {
  matrixResponsePublisher: MatrixResponsePublisher;

  static eventMayTriggerResponse(event: DiscreteMatrixEvent) {
    // If it's a message, we should respond unless it's a card fragment
    if (event.getType() === 'm.room.message') {
      return true;
    }

    // If it's a command result with output, we might respond
    if (
      event.getType() === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
      event.getContent().msgtype ===
        APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
    ) {
      return true;
    }

    // If it's a different type, or a command result without output, we should not respond
    return false;
  }

  static eventWillDefinitelyTriggerResponse(event: DiscreteMatrixEvent) {
    return (
      this.eventMayTriggerResponse(event) &&
      event.getType() !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE
    );
  }

  constructor(client: MatrixClient, roomId: string) {
    this.matrixResponsePublisher = new MatrixResponsePublisher(
      client,
      roomId,
      this.responseState,
    );
  }

  messagePromises: Promise<
    ISendEventResponse | void | { errorMessage: string }
  >[] = [];

  responseState = new ResponseState();

  needsMessageSend = false;

  async ensureThinkingMessageSent() {
    await this.matrixResponsePublisher.ensureThinkingMessageSent();
  }

  sendMessageEventWithThrottling = () => {
    this.needsMessageSend = true;
    this.sendMessageEventWithThrottlingInternal();
  };

  sendMessageEventWithThrottlingInternal: () => unknown = throttle(() => {
    this.needsMessageSend = false;
    this.sendMessageEvent();
  }, 250);

  sendMessageEvent = async () => {
    const messagePromise = this.matrixResponsePublisher
      .sendMessage()
      .catch((e) => {
        return {
          errorMessage: e.message,
        };
      });
    this.messagePromises.push(messagePromise);
    await messagePromise;
  };

  async onChunk(
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    snapshot: ChatCompletionSnapshot,
  ) {
    // reasoning does not support snapshots, so we need to handle the delta
    const newReasoningContent = (
      chunk.choices?.[0]?.delta as { reasoning?: string }
    )?.reasoning;

    const responseStateChanged = this.responseState.update(
      newReasoningContent,
      snapshot.choices?.[0]?.message?.content,
      snapshot.choices?.[0]?.message?.tool_calls,
      chunk.choices?.[0]?.finish_reason === 'stop',
    );
    if (responseStateChanged) {
      await this.sendMessageEventWithThrottling();
    }

    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens}`,
      );
    }

    return await Promise.all(this.messagePromises);
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

  async onError(error: OpenAIError | string) {
    Sentry.captureException(error);
    return await this.matrixResponsePublisher.sendError(error);
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

    let results = await Promise.all(this.messagePromises);

    for (let result of results) {
      if (result && 'errorMessage' in result) {
        await this.onError(result.errorMessage);
      }
    }
  }

  async finalize() {
    let isStreamingFinishedChanged =
      this.responseState.updateIsStreamingFinished(true);
    if (isStreamingFinishedChanged) {
      await this.sendMessageEventWithThrottling();
    }
    await this.flush();
  }
}
