import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';
import { thinkingMessage } from '../constants';
import ResponseState from './response-state';
import {
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
} from '@cardstack/runtime-common';

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

class ResponseEventData {
  needsContinuation = false;
  eventId?: string;
  contentStartIndex: number = 0;
  contentEndIndex: number = 0;
  constructor(
    eventId: string | undefined,
    readonly eventSizeMax: number,
    contentStartIndex: number = 0,
  ) {
    this.eventId = eventId;
    this.contentStartIndex = contentStartIndex;
  }

  contentWouldExceedMaxSize(content: string): boolean {
    return content.length - this.contentStartIndex > this.eventSizeMax;
  }

  contentForNextMessage(content: string): string {
    return content.slice(
      this.contentStartIndex,
      this.contentStartIndex + this.eventSizeMax,
    );
  }
}

export default class MatrixResponsePublisher {
  eventSizeMax = DEFAULT_EVENT_SIZE_MAX;
  responseEvents: ResponseEventData[] | undefined;

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
    if (!this.currentResponseEvent) {
      throw new Error(
        'No current response event. Ensure that the initial message has been sent.',
      );
    }
    while (
      this.currentResponseEvent.contentWouldExceedMaxSize(
        this.responseState.latestContent,
      )
    ) {
      let contentForCurrentEvent =
        this.currentResponseEvent.contentForNextMessage(
          this.responseState.latestContent,
        );
      // TODO: type as Partial<CardMessageContent>
      let extraData: any = {
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
        contentForCurrentEvent,
        this.currentResponseEventId,
        extraData,
        this.responseState.toolCalls.map((toolCall) =>
          toCommandRequest(toolCall as ChatCompletionMessageToolCall),
        ),
        this.responseState.latestReasoning,
      );
      this.currentResponseEvent.contentEndIndex =
        this.currentResponseEvent.contentStartIndex +
        contentForCurrentEvent.length;
      this.currentResponseEvent.needsContinuation = true;
      if (!this.currentResponseEvent.eventId) {
        this.currentResponseEvent.eventId = messageEvent.event_id;
      }
      this.responseEvents?.push(
        new ResponseEventData(
          undefined,
          this.eventSizeMax,
          this.currentResponseEvent.contentEndIndex,
        ),
      );
    }

    let contentForCurrentEvent;
    if (this.currentResponseEvent.needsContinuation) {
      contentForCurrentEvent = this.responseState.latestContent.slice(
        this.currentResponseEvent.contentEndIndex + 1,
        this.currentResponseEvent.contentEndIndex + 1 + this.eventSizeMax,
      );
    } else {
      contentForCurrentEvent = this.responseState.latestContent.slice(
        this.currentResponseEvent.contentStartIndex,
        this.currentResponseEvent.contentStartIndex + this.eventSizeMax,
      );
    }
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
      contentForCurrentEvent,
      this.currentResponseEventId,
      extraData,
      this.responseState.toolCalls.map((toolCall) =>
        toCommandRequest(toolCall as ChatCompletionMessageToolCall),
      ),
      this.responseState.latestReasoning,
    );
    if (!this.currentResponseEvent.eventId) {
      this.currentResponseEvent.eventId = messageEvent.event_id;
    }
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
