import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';
import { thinkingMessage } from '../constants';
import ResponseState from './response-state';

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
  contentStartIndex: number = 0;
  contentEndIndex: number = 0;
  constructor(
    readonly eventId: string,
    contentStartIndex: number = 0,
  ) {
    this.contentStartIndex = contentStartIndex;
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
    if (
      this.responseState.latestContent.length -
        this.currentResponseEvent.contentStartIndex >
      this.eventSizeMax
    ) {
      let contentForCurrentEvent = this.responseState.latestContent.slice(
        this.currentResponseEvent.contentStartIndex,
        this.currentResponseEvent.contentStartIndex + this.eventSizeMax,
      );
      this.currentResponseEvent.contentEndIndex =
        this.currentResponseEvent.contentStartIndex +
        contentForCurrentEvent.length;
      // TODO: type as Partial<CardMessageContent>
      let extraData: any = {
        isStreamingFinished: true,
        hasContinuation: true,
      };
      if (this.previousResponseEventId) {
        extraData['continuationOf'] = this.previousResponseEventId;
      }
      await sendMessageEvent(
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
      this.currentResponseEvent.needsContinuation = true;
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
    if (this.previousResponseEventId) {
      extraData['continuationOf'] = this.previousResponseEventId;
    }
    if (this.currentResponseEvent.needsContinuation) {
      extraData['continuationOf'] = this.currentResponseEventId;
    }

    let message = await sendMessageEvent(
      this.client,
      this.roomId,
      contentForCurrentEvent,
      this.currentResponseEvent.needsContinuation
        ? undefined
        : this.currentResponseEventId,
      extraData,
      this.responseState.toolCalls.map((toolCall) =>
        toCommandRequest(toolCall as ChatCompletionMessageToolCall),
      ),
      this.responseState.latestReasoning,
    );
    if (this.currentResponseEvent.needsContinuation) {
      this.responseEvents?.push(
        new ResponseEventData(
          message.event_id,
          this.currentResponseEvent.contentEndIndex + 1,
        ),
      );
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
    this.responseEvents = [new ResponseEventData(initialMessage.event_id)];
  }
}
