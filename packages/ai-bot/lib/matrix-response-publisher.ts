import { MatrixClient, sendErrorEvent, sendMessageEvent } from './matrix';

import { CommandRequest } from '@cardstack/runtime-common/commands';
import { thinkingMessage } from '../constants';
import ResponseState from './response-state';

export default class MatrixResponsePublisher {
  private initialMessageSent = false;
  responseEventIds: string[] | undefined;
  get currentResponseEventId() {
    return this.responseEventIds?.[this.responseEventIds.length - 1];
  }

  get originalResponseEventId() {
    return this.responseEventIds?.[0];
  }

  constructor(
    readonly client: MatrixClient,
    readonly roomId: string,
    readonly responseState: ResponseState,
  ) {}

  async sendMessage(
    data: any = {},
    commandRequests: Partial<CommandRequest>[] = [],
  ) {
    return sendMessageEvent(
      this.client,
      this.roomId,
      this.responseState.latestContent,
      this.currentResponseEventId,
      data,
      commandRequests,
      this.responseState.latestReasoning,
    );
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
      this.responseEventIds = [initialMessage.event_id];
      this.initialMessageSent = true;
    }
  }
}
