import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import type { CommandRequest } from '@cardstack/runtime-common/commands';
import { thinkingMessage } from '../../constants.ts';
import type ResponseState from '../response-state.ts';
import {
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
} from '@cardstack/runtime-common';
import { sendErrorEvent, sendMessageEvent } from '@cardstack/runtime-common/ai';
import type { CardMessageContent } from 'https://cardstack.com/base/matrix-event';
import ResponseEventData from './response-event-data.ts';
import { logger } from '@cardstack/runtime-common';
import type { MatrixClient } from 'matrix-js-sdk';

let log = logger('ai-bot');

function toCommandRequest(
  toolCall: ChatCompletionMessageFunctionToolCall,
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
  readonly client: MatrixClient;
  readonly roomId: string;
  readonly agentId: string;
  readonly responseState: ResponseState;
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
  }

  // When the bot is mid-turn there's already a "Thinking…" message on screen.
  // If the model then asks for a tool that ai-bot runs itself (readRealmFile),
  // rather than one it hands to the host, we want to show that work as a marker
  // right where the Thinking message is — and before the answer — so the turn
  // reads as "did this, then answered".
  //
  // To get that ordering we reuse the Thinking event: replace it in place with
  // the command requests, then rotate to a fresh event for whatever streams
  // next (the answer). Reusing it is what matters — that event already holds
  // this turn's earliest timeline slot, so the marker inherits the slot and the
  // answer in the fresh event sorts after it. Posting a brand-new marker
  // message instead would land it after the answer's event and render below it.
  //
  // The marker is sent finished with an empty body + the command requests. The
  // caller posts a result event against the returned event id to flip it from
  // in-progress to done/failed, and resets ResponseState so the next event
  // streams clean.
  async sendServerCommandMarker(
    commandRequests: Partial<CommandRequest>[],
  ): Promise<string | undefined> {
    await this.ensureThinkingMessageSent();
    let markerEventId = this.currentResponseEventId;
    let sendOperation = this.sendingMessage.then(async () => {
      await sendMessageEvent(
        this.client,
        this.roomId,
        '',
        markerEventId,
        {
          isStreamingFinished: true,
          data: { context: { agentId: this.agentId } },
        },
        commandRequests,
      );
      // Fresh event (no id yet) → the next send creates a new message that
      // sorts after this marker.
      this.responseEvents = [
        new ResponseEventData(undefined, this.eventSizeMax),
      ];
    });
    this.sendingMessage = sendOperation.catch(() => {});
    await sendOperation;
    return markerEventId;
  }
}
