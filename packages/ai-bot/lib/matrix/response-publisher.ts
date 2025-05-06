import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './util';
import { thinkingMessage } from '../../constants';
import ResponseState from '../response-state';
import {
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
} from '@cardstack/runtime-common';
import type { CardMessageContent } from 'https://cardstack.com/base/matrix-event';
import ResponseEventData from './response-event-data';

function toCommandRequest(
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

export const DEFAULT_EVENT_SIZE_MAX = 1024 * 16; // 16kB

export default class MatrixResponsePublisher {
  eventSizeMax = DEFAULT_EVENT_SIZE_MAX;
  responseEvents: ResponseEventData[] | undefined;
  private sendingMessage = Promise.resolve(); // track pending send operation

  get currentResponseEvent() {
    return this.responseEvents?.[this.responseEvents.length - 1];
  }
  get currentResponseEventId() {
    return this.currentResponseEvent?.eventId;
  }

  get originalResponseEventId() {
    return this.responseEvents?.[0]?.eventId;
  }

  get previousResponseEventId() {
    return this.responseEvents?.[this.responseEvents.length - 2]?.eventId;
  }

  get initialMessageSent() {
    return !!this.originalResponseEventId;
  }

  constructor(
    readonly client: MatrixClient,
    readonly roomId: string,
    readonly responseState: ResponseState,
  ) {}

  async sendMessage() {
    // Wait for previous sends to complete
    const sendOperation = this.sendingMessage.then(async () => {
      if (!this.currentResponseEvent) {
        throw new Error(
          'No current response event. Ensure that the initial message has been sent.',
        );
      }
      while (
        this.currentResponseEvent.wouldExceedMaxSize(
          this.responseState.latestReasoning,
          this.responseState.latestContent,
        )
      ) {
        let reasoningAndContent =
          this.currentResponseEvent.reasoningAndContentForNextMessage(
            this.responseState.latestReasoning,
            this.responseState.latestContent,
          );
        let extraData: Partial<CardMessageContent> = {
          isStreamingFinished: true,
          [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
        };
        if (this.previousResponseEventId) {
          extraData[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] =
            this.previousResponseEventId;
        }
        let messageEvent = await sendMessageEvent(
          this.client,
          this.roomId,
          reasoningAndContent.content,
          this.currentResponseEventId,
          extraData,
          this.responseState.toolCalls.map((toolCall) =>
            toCommandRequest(toolCall as ChatCompletionMessageToolCall),
          ),
          reasoningAndContent.reasoning,
        );
        this.currentResponseEvent.updateEndIndices(reasoningAndContent);
        this.currentResponseEvent.needsContinuation = true;
        if (!this.currentResponseEvent.eventId) {
          this.currentResponseEvent.eventId = messageEvent.event_id;
        }
        this.responseEvents?.push(this.currentResponseEvent.buildNextEvent());
      }

      let contentAndReasoning =
        this.currentResponseEvent.reasoningAndContentForNextMessage(
          this.responseState.latestReasoning,
          this.responseState.latestContent,
        );
      let extraData: any = {
        isStreamingFinished: this.responseState.isStreamingFinished,
      };
      if (this.currentResponseEvent.needsContinuation) {
        extraData[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] =
          this.currentResponseEventId;
      } else if (this.previousResponseEventId) {
        extraData[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] =
          this.previousResponseEventId;
      }

      let messageEvent = await sendMessageEvent(
        this.client,
        this.roomId,
        contentAndReasoning.content,
        this.currentResponseEventId,
        extraData,
        this.responseState.toolCalls.map((toolCall) =>
          toCommandRequest(toolCall as ChatCompletionMessageToolCall),
        ),
        contentAndReasoning.reasoning,
      );
      if (!this.currentResponseEvent.eventId) {
        this.currentResponseEvent.eventId = messageEvent.event_id;
      }
    });

    // Update the queue to include this operation
    this.sendingMessage = sendOperation.catch(() => {});

    // Return the result of this operation
    return sendOperation;
  }

  async sendError(error: any) {
    sendErrorEvent(
      this.client,
      this.roomId,
      error,
      this.originalResponseEventId,
    );
  }

  async ensureThinkingMessageSent() {
    if (this.initialMessageSent) {
      return;
    }

    let initialMessage = await sendMessageEvent(
      this.client,
      this.roomId,
      '',
      undefined,
      { isStreamingFinished: false },
      [],
      thinkingMessage,
    );
    this.responseEvents = [
      new ResponseEventData(initialMessage.event_id, this.eventSizeMax),
    ];
  }
}
