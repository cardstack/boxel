import { cleanContent } from '../helpers';
import { logger } from '@cardstack/runtime-common';
import { MatrixClient, sendError, sendMessage, sendOption } from './matrix';

import * as Sentry from '@sentry/node';
import { OpenAIError } from 'openai/error';

let log = logger('ai-bot');

export class Responder {
  // internally has a debounced function that will send the text messages

  initialMessageId: string | undefined;
  initialMessageReplaced = false;
  unsent = 0;
  client: MatrixClient;
  roomId: string;

  constructor(client: MatrixClient, roomId: string) {
    this.roomId = roomId;
    this.client = client;
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

  // Can have
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
    this.unsent += 1;
    if (this.unsent > 40) {
      this.unsent = 0;
      await sendMessage(
        this.client,
        this.roomId,
        cleanContent(snapshot),
        this.initialMessageId,
      );
    }
    this.initialMessageReplaced = true;
  }

  async onMessage(msg: {
    role: string;
    tool_calls?: { function: { name: string; arguments: string } }[];
  }) {
    if (msg.role === 'assistant') {
      for (const toolCall of msg.tool_calls || []) {
        const functionCall = toolCall.function;
        log.debug('[Room Timeline] Function call', toolCall);
        let args;
        try {
          args = JSON.parse(functionCall.arguments);
        } catch (error) {
          Sentry.captureException(error);
          return await sendError(
            this.client,
            this.roomId,
            error,
            this.initialMessageReplaced ? undefined : this.initialMessageId,
          );
          this.initialMessageReplaced = true;
        }
        if (functionCall.name === 'patchCard') {
          await sendOption(
            this.client,
            this.roomId,
            args,
            this.initialMessageReplaced ? undefined : this.initialMessageId,
          );
          this.initialMessageReplaced = true;
        }
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
      await sendMessage(
        this.client,
        this.roomId,
        finalContent,
        this.initialMessageId,
        {
          isStreamingFinished: true,
        },
      );
    }
  }
}
