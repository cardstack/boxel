import { logger } from '@cardstack/runtime-common';
import { isCommandOrCodePatchResult, type MatrixClient } from './matrix/util';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import throttle from 'lodash/throttle';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
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

    // If it's a command result or a code patch result, we might respond
    if (isCommandOrCodePatchResult(event)) {
      return true;
    }

    // If it's a different type
    return false;
  }

  static eventWillDefinitelyTriggerResponse(event: DiscreteMatrixEvent) {
    return (
      this.eventMayTriggerResponse(event) && !isCommandOrCodePatchResult(event)
    );
  }

  constructor(client: MatrixClient, roomId: string, agentId: string) {
    this.matrixResponsePublisher = new MatrixResponsePublisher(
      client,
      roomId,
      agentId,
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
    if (this.needsMessageSend) {
      return; // already scheduled
    }
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


    let toolCalls = snapshot.choices?.[0]?.message?.tool_calls?.filter((call) =>
      Boolean(call),
    );

    const responseStateChanged = this.responseState.update(
      newReasoningContent,
      snapshot.choices?.[0]?.message?.content,
      toolCalls,
      chunk.choices?.[0]?.finish_reason === 'stop',
    );
    log.debug('onChunk', {
      reasoning: this.responseState.latestReasoning,
      content: this.responseState.latestContent,
      toolCalls: this.responseState.toolCalls,
      isStreamingFinished: this.responseState.isStreamingFinished,
      responseStateChanged,
    });
    if (responseStateChanged) {
      await this.sendMessageEventWithThrottling();
    }

    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens} completion tokens`,
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
    if (this.responseState.isStreamingFinished) {
      return;
    }
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
  isFinalized = false;
  async finalize(opts?: { isCanceled?: boolean }) {
    if (this.isFinalized) {
      return;
    }
    this.isFinalized = true;

    let isStreamingFinishedChanged =
      this.responseState.updateIsStreamingFinished(true, opts?.isCanceled);
    log.debug('finalize', {
      isStreamingFinishedChanged,
    });
    if (isStreamingFinishedChanged) {
      await this.sendMessageEventWithThrottling();
    }
    await this.flush();
  }
}
