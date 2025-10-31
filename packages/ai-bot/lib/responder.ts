import { logger } from '@cardstack/runtime-common';
import { isCommandOrCodePatchResult } from '@cardstack/runtime-common/ai';

import * as Sentry from '@sentry/node';
import type { OpenAIError } from 'openai/error';
import throttle from 'lodash/throttle';
import type { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import type { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import type { MatrixEvent as DiscreteMatrixEvent } from 'matrix-js-sdk';
import MatrixResponsePublisher from './matrix/response-publisher';
import ResponseState from './response-state';
import type { MatrixClient } from 'matrix-js-sdk';

let log = logger('ai-bot');

export class Responder {
  matrixResponsePublisher: MatrixResponsePublisher;
  private _lastSentTotal = 0;
  private _lastSentContentLen = 0;
  private _lastSentReasoningLen = 0;
  private _lastSentToolCallsJson: string | undefined;

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

  sendMessageEventWithThrottlingInternal: () => unknown = throttle(
    () => {
      this.needsMessageSend = false;
      this.sendMessageEvent();
    },
    Number(process.env.AI_BOT_STREAM_THROTTLE_MS ?? 250),
  );

  sendMessageEvent = async () => {
    // Only send if the delta is meaningful, unless we are finalizing.
    const minDelta = Number(process.env.AI_BOT_STREAM_MIN_DELTA ?? 0);
    const latestContentLen = (this.responseState.latestContent || '').length;
    const reasoningText = this.responseState.latestReasoning || '';
    const latestReasoningLen = reasoningText.length;
    const toolCallsJson = JSON.stringify(this.responseState.toolCalls || []);
    const currentTotal = latestContentLen + latestReasoningLen;
    // Track last-sent size on the instance
    const lastSent = this._lastSentTotal;
    const contentDelta = latestContentLen - this._lastSentContentLen;
    const reasoningDelta = latestReasoningLen - this._lastSentReasoningLen;
    const toolCallsChanged = toolCallsJson !== this._lastSentToolCallsJson;

    const isFinal = this.responseState.isStreamingFinished;
    const isFirstContent = lastSent === 0 && currentTotal > 0;
    const shouldSend =
      isFinal ||
      isFirstContent ||
      reasoningDelta > 0 ||
      toolCallsChanged ||
      contentDelta >= minDelta;
    if (!shouldSend) {
      return;
    }

    const messagePromise = this.matrixResponsePublisher
      .sendMessage()
      .catch((e) => {
        return {
          errorMessage: e.message,
        };
      });
    // Update last-sent size only when we actually send
    this._lastSentTotal = currentTotal;
    this._lastSentContentLen = latestContentLen;
    this._lastSentReasoningLen = latestReasoningLen;
    this._lastSentToolCallsJson = toolCallsJson;
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
    toolCall: ChatCompletionMessageFunctionToolCall,
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
    Sentry.captureException(error, {
      extra: {
        roomId: this.matrixResponsePublisher.roomId,
        agentId: this.matrixResponsePublisher.agentId,
      },
    });
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
