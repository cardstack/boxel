import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';
import throttle from 'lodash/throttle';
import { ISendEventResponse } from 'matrix-js-sdk/lib/matrix';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import { thinkingMessage } from '../constants';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

let log = logger('ai-bot');

export class Responder {
  static eventMayTriggerResponse(event: DiscreteMatrixEvent) {
    // If it's a message, we should respond unless it's a card fragment
    if (event.getType() === 'm.room.message') {
      if (
        event.getContent().msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE ||
        event.getContent().msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE
      ) {
        return false;
      }
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

  constructor(
    readonly client: MatrixClient,
    readonly roomId: string,
  ) {}

  messagePromises: Promise<ISendEventResponse | void>[] = [];

  initialMessageSent = false;
  responseEventId: string | undefined;
  latestReasoning = '';
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
      this.latestReasoning,
    );
    this.messagePromises.push(messagePromise);
    await messagePromise;
  };

  async ensureThinkingMessageSent() {
    if (!this.initialMessageSent) {
      let initialMessage = await sendMessageEvent(
        this.client,
        this.roomId,
        '',
        undefined,
        { isStreamingFinished: false },
        [],
        thinkingMessage,
      );
      this.responseEventId = initialMessage.event_id;
      this.initialMessageSent = true;
    }
  }

  async onChunk(
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    snapshot: ChatCompletionSnapshot,
  ) {
    const toolCallsSnapshot = snapshot.choices?.[0]?.message?.tool_calls;
    if (toolCallsSnapshot?.length) {
      let latestToolCallsJson = JSON.stringify(toolCallsSnapshot);
      if (this.toolCallsJson !== latestToolCallsJson) {
        this.toolCalls = toolCallsSnapshot;
        this.toolCallsJson = latestToolCallsJson;
        await this.sendMessageEventWithThrottling();
      }
    }

    let contentSnapshot = snapshot.choices?.[0]?.message?.content;
    if (contentSnapshot?.length) {
      contentSnapshot = cleanContent(contentSnapshot);
      if (this.latestContent !== contentSnapshot) {
        if (this.latestReasoning === thinkingMessage) {
          this.latestReasoning = '';
        }
        this.latestContent = contentSnapshot;
        await this.sendMessageEventWithThrottling();
      }
    }

    // reasoning does not support snapshots, so we need to handle the delta
    let newReasoningContent = chunk.choices?.[0]?.delta?.reasoning;
    if (newReasoningContent?.length) {
      if (this.latestReasoning === thinkingMessage) {
        this.latestReasoning = '';
      }
      this.latestReasoning = this.latestReasoning + newReasoningContent;
      await this.sendMessageEventWithThrottling();
    }

    if (snapshot.choices?.[0]?.finish_reason === 'stop') {
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
  ): Partial<CommandRequest> {
    let { id, function: f } = toolCall;
    let result = {} as Partial<CommandRequest>;
    if (id) {
      result['id'] = id;
    }
    if (f.name) {
      result['name'] = f.name;
    }
    if (f.arguments) {
      try {
        result['arguments'] = JSON.parse(f.arguments);
      } catch (error) {
        // If the arguments are not valid JSON, we'll just return an empty object
        // This will happen during streaming, when the tool call is not yet complete
        // and the arguments are not yet available
        result['arguments'] = {};
      }
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
    if (!this.isStreamingFinished) {
      this.isStreamingFinished = true;
      await this.sendMessageEventWithThrottling();
    }
    await this.flush();
  }
}
