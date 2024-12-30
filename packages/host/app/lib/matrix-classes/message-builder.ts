import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { inject as service } from '@ember/service';

import { LooseSingleCardDocument } from '@cardstack/runtime-common';

import {
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type CommandService from '@cardstack/host/services/command-service';

import type { CommandStatus } from 'https://cardstack.com/base/command';

import type {
  CardMessageContent,
  CardMessageEvent,
  CommandEvent,
  CommandReactionEventContent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
  ReactionEvent,
} from 'https://cardstack.com/base/matrix-event';

import { RoomMember } from './member';
import { Message } from './message';
import MessageCommand from './message-command';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

export default class MessageBuilder {
  constructor(
    private event: MessageEvent | CommandEvent | CardMessageEvent,
    owner: Owner,
    private builderContext: {
      effectiveEventId: string;
      author: RoomMember;
      index: number;
      serializedCardFromFragments: (eventId: string) => LooseSingleCardDocument;
      events: DiscreteMatrixEvent[];
    },
  ) {
    setOwner(this, owner);
  }

  @service declare commandService: CommandService;

  private get coreMessageArgs() {
    return new Message({
      author: this.builderContext.author,
      created: new Date(this.event.origin_server_ts),
      updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
      message: this.event.content.body,
      formattedMessage: this.event.content.formatted_body,
      // These are not guaranteed to exist in the event
      transactionId: this.event.unsigned?.transaction_id || null,
      attachedCardIds: null,
      command: null,
      status: this.event.status,
      eventId: this.builderContext.effectiveEventId,
      index: this.builderContext.index,
    });
  }

  get clientGeneratedId() {
    return (this.event.content as CardMessageContent).clientGeneratedId;
  }

  get attachedCardIds() {
    let content = this.event.content as CardMessageContent;
    // Safely skip over cases that don't have attached cards or a data type
    let cardDocs = content.data?.attachedCardsEventIds
      ? content.data.attachedCardsEventIds.map((eventId) =>
          this.builderContext.serializedCardFromFragments(eventId),
        )
      : [];
    let attachedCardIds: string[] = [];
    cardDocs.map((c) => {
      if (c.data.id) {
        attachedCardIds.push(c.data.id);
      }
    });
    if (attachedCardIds.length < cardDocs.length) {
      throw new Error(`cannot handle cards in room without an ID`);
    }
    return attachedCardIds;
  }

  get errorMessage() {
    let errorMessage: string | undefined;
    let { event } = this;
    if (event.status === 'cancelled' || event.status === 'not_sent') {
      errorMessage =
        event.error?.data.errcode &&
        Object.keys(ErrorMessage).includes(event.error?.data.errcode)
          ? ErrorMessage[event.error?.data.errcode]
          : 'Failed to send';
    }
    if ('errorMessage' in event.content) {
      errorMessage = event.content.errorMessage;
    }
    return errorMessage;
  }

  get formattedMessageForCommand() {
    return `<p data-test-command-message class="command-message">${this.event.content.formatted_body}</p>`;
  }

  async buildMessage(): Promise<Message> {
    let { event } = this;
    let messageArgs = this.coreMessageArgs;
    messageArgs.errorMessage = this.errorMessage;
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      messageArgs.clientGeneratedId = this.clientGeneratedId;
      messageArgs.attachedCardIds = this.attachedCardIds;
    } else if (event.content.msgtype === 'm.text') {
      messageArgs.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
    } else if (
      event.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE &&
      event.content.data.toolCall
    ) {
      messageArgs.formattedMessage = this.formattedMessageForCommand;
      messageArgs.command = await this.buildMessageCommand();
      messageArgs.isStreamingFinished = true;
    }
    return messageArgs;
  }

  private async buildMessageCommand() {
    let event = this.event as CommandEvent;
    let command = event.content.data.toolCall;
    let annotation = this.builderContext.events.find((e: any) => {
      let r = e.content['m.relates_to'];
      return (
        e.type === 'm.reaction' &&
        e.content.msgtype === 'org.boxel.command_result' &&
        r?.rel_type === 'm.annotation' &&
        (r?.event_id === event.content.data.eventId ||
          r?.event_id === event.event_id ||
          r?.event_id === this.builderContext.effectiveEventId)
      );
    }) as ReactionEvent | undefined;
    let status: CommandStatus = 'ready';
    let reactionContent = annotation?.content as
      | CommandReactionEventContent
      | undefined;
    if (reactionContent && reactionContent['m.relates_to'].key === 'applied') {
      status = 'applied';
    }
    let commandResultCardId: string | undefined =
      reactionContent?.data.card_event_id ?? undefined;
    let messageCommand = new MessageCommand(
      command.id,
      command.name,
      command.arguments,
      this.builderContext.effectiveEventId,
      status,
      commandResultCardId,
      getOwner(this)!,
    );
    return messageCommand;
  }
}
