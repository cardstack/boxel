import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { inject as service } from '@ember/service';

import {
  LooseSingleCardDocument,
  sanitizeHtml,
} from '@cardstack/runtime-common';

import {
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type CommandService from '@cardstack/host/services/command-service';

import type { CommandStatus } from 'https://cardstack.com/base/command';

import type {
  CardMessageContent,
  CardMessageEvent,
  CommandEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
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
      roomId: string;
      effectiveEventId: string;
      author: RoomMember;
      index: number;
      serializedCardFromFragments: (eventId: string) => LooseSingleCardDocument;
      events: DiscreteMatrixEvent[];
      commandResultEvent?: CommandResultEvent;
    },
  ) {
    setOwner(this, owner);
  }

  @service declare commandService: CommandService;

  private get coreMessageArgs() {
    return new Message({
      roomId: this.builderContext.roomId,
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

  private get formattedMessageForCommand() {
    return `<p data-test-command-message class="command-message">${sanitizeHtml(
      this.event.content.formatted_body,
    )}</p>`;
  }

  buildMessage(): Message {
    let { event } = this;
    let message = this.coreMessageArgs;
    message.errorMessage = this.errorMessage;
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      message.clientGeneratedId = this.clientGeneratedId;
      message.attachedCardIds = this.attachedCardIds;
    } else if (event.content.msgtype === 'm.text') {
      message.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
    } else if (event.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE) {
      message.formattedMessage = this.formattedMessageForCommand;
      const command = this.buildMessageCommand(message);
      if (command) {
        message.command = command;
      } else {
        message.isPreparingCommand = true;
      }
      message.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
    }
    return message;
  }

  updateMessage(message: Message) {
    if (this.event.content['m.relates_to']?.rel_type !== 'm.replace') {
      return;
    }

    if (message.created.getTime() > this.event.origin_server_ts) {
      message.created = new Date(this.event.origin_server_ts);
      return;
    }

    message.message = this.event.content.body;
    message.formattedMessage = this.event.content.formatted_body;
    message.isStreamingFinished =
      'isStreamingFinished' in this.event.content
        ? this.event.content.isStreamingFinished
        : undefined;
    message.updated = new Date();

    if (this.event.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE) {
      message.formattedMessage = this.formattedMessageForCommand;

      const latestCommand = this.buildMessageCommand(message);
      if (!message.command && latestCommand) {
        message.command = latestCommand;
        message.isPreparingCommand = false;
      } else if (latestCommand && message.command) {
        message.command.name = latestCommand.name;
        message.command.payload = latestCommand.payload;
      } else {
        message.isPreparingCommand = true;
      }
    }
  }

  updateMessageCommandResult(message: Message) {
    if (!message.command) {
      message.command = this.buildMessageCommand(message);
    }

    if (this.builderContext.commandResultEvent && message.command) {
      let event = this.builderContext.commandResultEvent;
      message.command.commandStatus = event.content['m.relates_to']
        .key as CommandStatus;
      message.command.commandResultCardEventId =
        event.content.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
          ? event.content.data.cardEventId
          : undefined;
    }
  }

  private buildMessageCommand(message: Message) {
    let event = this.event as CommandEvent;
    let commandResultEvent =
      this.builderContext.commandResultEvent ??
      (this.builderContext.events.find((e: any) => {
        let r = e.content['m.relates_to'];
        return (
          e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          r.rel_type === 'm.annotation' &&
          (r.event_id === event!.event_id ||
            r.event_id === this.builderContext.effectiveEventId)
        );
      }) as CommandResultEvent | undefined);

    if (event.content.isStreamingFinished !== false && event.content.data) {
      let command = event.content.data.toolCall;
      let messageCommand = new MessageCommand(
        message,
        command.id,
        command.name,
        command.arguments,
        this.builderContext.effectiveEventId,
        (commandResultEvent?.content['m.relates_to']?.key ||
          'ready') as CommandStatus,
        commandResultEvent?.content.msgtype ===
        APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
          ? commandResultEvent.content.data.cardEventId
          : undefined,
        getOwner(this)!,
      );
      return messageCommand;
    }
    return null;
  }
}
