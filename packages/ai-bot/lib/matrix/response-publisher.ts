import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import type { ToolRequest } from '@cardstack/runtime-common/commands';
import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';
import {
  READ_REALM_FILE_TOOL_NAME,
  readFilesLabel,
} from '../read-realm-file.ts';
import { thinkingMessage } from '../../constants.ts';
import type ResponseState from '../response-state.ts';
import {
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
} from '@cardstack/runtime-common';
import { sendErrorEvent, sendMessageEvent } from '@cardstack/runtime-common/ai';
import type { CardMessageContent } from '@cardstack/base/matrix-event';
import ResponseEventData from './response-event-data.ts';
import { logger } from '@cardstack/runtime-common';
import type { MatrixClient } from 'matrix-js-sdk';

let log = logger('ai-bot');

export function toCommandRequest(
  toolCall: ChatCompletionMessageFunctionToolCall,
): Partial<ToolRequest> {
  let { id, function: f } = toolCall;
  let result = {} as Partial<ToolRequest>;
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
  // readRealmFile is a tool ai-bot fulfills itself: tag it so the host records
  // it in the timeline but never runs it, and give it a human label the
  // timeline indicator can show ("Read files: <names>") since the raw
  // arguments carry no description of their own.
  if (result.name === READ_REALM_FILE_TOOL_NAME) {
    result.executedBy = AI_BOT_EXECUTOR;
    result.arguments = {
      ...(result.arguments ?? {}),
      description: readFilesLabel(result.arguments?.urls),
    };
  }
  return result;
}

export const DEFAULT_EVENT_SIZE_MAX = 1024 * 16; // 16kB

export default class MatrixResponsePublisher {
  readonly client: MatrixClient;
  readonly roomId: string;
  readonly agentId: string;
  readonly responseState: ResponseState;
  eventSizeMax = DEFAULT_EVENT_SIZE_MAX;
  responseEvents: ResponseEventData[] | undefined;
  // Count of Matrix room events this publisher has sent this turn (thinking
  // placeholder, streamed message edits, continuation splits, and errors).
  // Read by the Responder's per-turn telemetry line to compare room-event
  // volume across streaming modes.
  roomEventsEmitted = 0;
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
    client: MatrixClient,
    roomId: string,
    agentId: string,
    responseState: ResponseState,
  ) {
    this.client = client;
    this.roomId = roomId;
    this.agentId = agentId;
    this.responseState = responseState;
  }

  async sendMessage() {
    let responseStateSnapshot = this.responseState.snapshot();
    // Wait for previous sends to complete
    const sendOperation = this.sendingMessage.then(async () => {
      if (!this.currentResponseEvent) {
        throw new Error(
          'No current response event. Ensure that the initial message has been sent.',
        );
      }
      while (
        this.currentResponseEvent.wouldExceedMaxSize(
          responseStateSnapshot.reasoning,
          responseStateSnapshot.content,
        )
      ) {
        log.debug(
          'matrix/reponse-publisher',
          'message would exceed max size, splitting',
        );
        let reasoningAndContent =
          this.currentResponseEvent.reasoningAndContentForNextMessage(
            responseStateSnapshot.reasoning,
            responseStateSnapshot.content,
          );
        let extraData: Partial<CardMessageContent> = {
          isStreamingFinished: true,
          data: {
            context: {
              agentId: this.agentId,
            },
          },
          [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]: true,
        };
        if (this.previousResponseEventId) {
          extraData[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] =
            this.previousResponseEventId;
        }
        this.currentResponseEvent.updateEndIndices(reasoningAndContent);
        this.currentResponseEvent.needsContinuation = true;
        let messageEvent = await sendMessageEvent(
          this.client,
          this.roomId,
          reasoningAndContent.content,
          this.currentResponseEventId,
          extraData,
          responseStateSnapshot.toolCalls.map((toolCall) =>
            toCommandRequest(toolCall as ChatCompletionMessageFunctionToolCall),
          ),
          reasoningAndContent.reasoning,
        );
        this.roomEventsEmitted++;
        if (!this.currentResponseEvent.eventId) {
          this.currentResponseEvent.eventId = messageEvent.event_id;
        }
        this.responseEvents?.push(this.currentResponseEvent.buildNextEvent());
      }

      let contentAndReasoning =
        this.currentResponseEvent.reasoningAndContentForNextMessage(
          responseStateSnapshot.reasoning,
          responseStateSnapshot.content,
        );
      log.debug('matrix/reponse-publisher', contentAndReasoning);

      let extraData: any = {
        isStreamingFinished: responseStateSnapshot.isStreamingFinished,
        isCanceled: responseStateSnapshot.isCanceled,
        data: {
          context: {
            agentId: this.agentId,
          },
        },
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
        responseStateSnapshot.toolCalls
          .filter(Boolean) // Elide empty tool calls, which can be produced by gpt-5 at the time of this writing
          .map((toolCall) =>
            toCommandRequest(toolCall as ChatCompletionMessageFunctionToolCall),
          ),
        contentAndReasoning.reasoning,
      );
      this.roomEventsEmitted++;
      if (!this.currentResponseEvent.eventId) {
        this.currentResponseEvent.eventId = messageEvent.event_id;
      }
    });

    // Update the queue to include this operation
    this.sendingMessage = sendOperation.catch(() => {});

    // Return the result of this operation
    return sendOperation;
  }

  async sendError(error: any, opts?: { reloadBillingData?: boolean }) {
    sendErrorEvent(
      this.client,
      this.roomId,
      error,
      this.originalResponseEventId,
      opts,
    );
    this.roomEventsEmitted++;
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
      {
        isStreamingFinished: false,
        data: { context: { agentId: this.agentId } },
      },
      [],
      thinkingMessage,
    );
    this.responseEvents = [
      new ResponseEventData(initialMessage.event_id, this.eventSizeMax),
    ];
    this.roomEventsEmitted++;
  }
}
