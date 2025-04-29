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
  reasoningStartIndex: number = 0;
  reasoningEndIndex: number = 0;
  constructor(
    eventId: string | undefined,
    readonly eventSizeMax: number,
    contentStartIndex: number = 0,
  ) {
    this.eventId = eventId;
    this.contentStartIndex = contentStartIndex;
  }

  wouldExceedMaxSize(reasoning: string, content: string): boolean {
    let proposedSize = reasoning.length - this.reasoningStartIndex;
    proposedSize += content.length - this.contentStartIndex;
    return proposedSize > this.eventSizeMax;
  }

  reasoningAndContentForNextMessage(
    reasoning: string,
    content: string,
  ): { reasoning: string; content: string } {
    let reasoningForNextMessage = reasoning.slice(
      this.reasoningStartIndex,
      this.reasoningStartIndex + this.eventSizeMax,
    );
    let remainingBudget = this.eventSizeMax - reasoningForNextMessage.length;
    if (remainingBudget <= 0) {
      return {
        reasoning: reasoningForNextMessage,
        content: '',
      };
    }
    let contentForNextMessage = content.slice(
      this.contentStartIndex,
      this.contentStartIndex + remainingBudget,
    );
    return {
      reasoning: reasoningForNextMessage,
      content: contentForNextMessage,
    };
  }

  updateEndIndices(reasoningAndContent: {
    reasoning: string;
    content: string;
  }): void {
    this.reasoningEndIndex =
      this.reasoningStartIndex + reasoningAndContent.reasoning.length;
    this.contentEndIndex =
      this.contentStartIndex + reasoningAndContent.content.length;
  }

  buildNextEvent(): ResponseEventData {
    let nextEvent = new ResponseEventData(undefined, this.eventSizeMax);
    nextEvent.contentStartIndex = this.contentEndIndex;
    nextEvent.reasoningStartIndex = this.reasoningEndIndex;
    return nextEvent;
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
