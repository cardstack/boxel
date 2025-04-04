import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { inject as service } from '@ember/service';

import { TrackedArray } from 'tracked-built-ins';

import {
  LooseSingleCardDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import { RoomSkill } from '@cardstack/host/resources/room';
import type CommandService from '@cardstack/host/services/command-service';

import MatrixService from '@cardstack/host/services/matrix-service';

import type { CommandStatus } from 'https://cardstack.com/base/command';
import { SerializedFile } from 'https://cardstack.com/base/file-api';
import type {
  CardMessageContent,
  CardMessageEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
} from 'https://cardstack.com/base/matrix-event';
import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import { RoomMember } from './member';
import { Message } from './message';
import MessageCommand from './message-command';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

export default class MessageBuilder {
  constructor(
    private event: MessageEvent | CardMessageEvent,
    owner: Owner,
    private builderContext: {
      roomId: string;
      effectiveEventId: string;
      author: RoomMember;
      index: number;
      serializedCardFromFragments: (eventId: string) => LooseSingleCardDocument;
      skills: RoomSkill[];
      events: DiscreteMatrixEvent[];
      commandResultEvent?: CommandResultEvent;
      skillCardsCache: Map<string, SkillCard>;
    },
  ) {
    setOwner(this, owner);
  }

  @service declare private commandService: CommandService;
  @service declare private matrixService: MatrixService;

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
      status: this.event.status,
      eventId: this.builderContext.effectiveEventId,
      index: this.builderContext.index,
      attachedFiles: this.attachedFiles,
      reasoningContent:
        (this.event.content as CardMessageContent)['app.boxel.reasoning'] ||
        null,
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

  get attachedFiles() {
    let content = this.event.content as CardMessageContent;
    // Safely skip over cases that don't have attached cards or a data type
    return content.data?.attachedFiles
      ? content.data?.attachedFiles.map((attachedFile: SerializedFile) =>
          this.matrixService.fileAPI.createFileDef(attachedFile),
        )
      : undefined;
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

  buildMessage(): Message {
    let { event } = this;
    let message = this.coreMessageArgs;
    message.errorMessage = this.errorMessage;
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      message.clientGeneratedId = this.clientGeneratedId;
      message.attachedCardIds = this.attachedCardIds;
      if (event.content[APP_BOXEL_COMMAND_REQUESTS_KEY]) {
        message.commands = this.buildMessageCommands(message);
      }
    } else if (event.content.msgtype === 'm.text') {
      message.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
    }
    return message;
  }

  updateMessage(message: Message) {
    if (message.created.getTime() > this.event.origin_server_ts) {
      message.created = new Date(this.event.origin_server_ts);
      return;
    }

    message.message = this.event.content.body;
    message.formattedMessage = this.event.content.formatted_body;
    message.reasoningContent =
      (this.event.content as CardMessageContent)[
        APP_BOXEL_REASONING_CONTENT_KEY
      ] || null;
    message.isStreamingFinished =
      'isStreamingFinished' in this.event.content
        ? this.event.content.isStreamingFinished
        : undefined;
    message.updated = new Date();

    let commandRequests =
      (this.event.content as CardMessageContent)[
        APP_BOXEL_COMMAND_REQUESTS_KEY
      ] ?? [];
    for (let commandRequest of commandRequests) {
      let command = message.commands.find(
        (c) => c.commandRequest.id === commandRequest.id,
      );
      if (command) {
        command.commandRequest = commandRequest;
      } else {
        message.commands.push(
          this.buildMessageCommand(message, commandRequest),
        );
      }
    }
  }

  updateMessageCommandResult(message: Message) {
    if (message.commands.length === 0) {
      message.commands = this.buildMessageCommands(message);
    }

    if (this.builderContext.commandResultEvent && message.commands.length > 0) {
      let event = this.builderContext.commandResultEvent;
      let messageCommand = message.commands.find(
        (c) => c.commandRequest.id === event.content.commandRequestId,
      );
      if (messageCommand) {
        messageCommand.commandStatus = event.content['m.relates_to']
          .key as CommandStatus;
        messageCommand.commandResultCardEventId =
          event.content.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
            ? event.content.data.cardEventId
            : undefined;
      }
    }
  }

  private buildMessageCommands(message: Message) {
    let eventContent = this.event.content as CardMessageContent;
    let commandRequests = eventContent[APP_BOXEL_COMMAND_REQUESTS_KEY];
    if (!commandRequests) {
      return new TrackedArray<MessageCommand>();
    }
    let commands = new TrackedArray<MessageCommand>();
    for (let commandRequest of commandRequests) {
      let command = this.buildMessageCommand(message, commandRequest);
      commands.push(command);
    }
    return commands;
  }

  private buildMessageCommand(
    message: Message,
    commandRequest: Partial<CommandRequest>,
  ) {
    let commandResultEvent =
      this.builderContext.commandResultEvent ??
      (this.builderContext.events.find((e: any) => {
        let r = e.content['m.relates_to'];
        return (
          e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          r.rel_type === APP_BOXEL_COMMAND_RESULT_REL_TYPE &&
          (r.event_id === this.event.event_id ||
            r.event_id === this.builderContext.effectiveEventId) &&
          e.content.commandRequestId === commandRequest.id
        );
      }) as CommandResultEvent | undefined);

    // Find command in skills
    let skillCommand:
      | { codeRef: ResolvedCodeRef; requiresApproval: boolean }
      | undefined;
    findCommand: for (let skill of this.builderContext.skills) {
      let skillCard = this.builderContext.skillCardsCache.get(skill.cardId);
      if (!skillCard) {
        continue;
      }
      for (let candidateSkillCommand of skillCard.commands) {
        if (commandRequest.name === candidateSkillCommand.functionName) {
          skillCommand = candidateSkillCommand;
          break findCommand;
        }
      }
    }
    let messageCommand = new MessageCommand(
      message,
      commandRequest,
      skillCommand?.codeRef,
      this.builderContext.effectiveEventId,
      skillCommand?.requiresApproval ?? true,
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
}
