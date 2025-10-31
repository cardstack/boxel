import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { inject as service } from '@ember/service';

import { TrackedArray } from 'tracked-built-ins';

import {
  type ResolvedCodeRef,
  getClass,
  isCardInstance,
} from '@cardstack/runtime-common';

import type { CommandRequest } from '@cardstack/runtime-common/commands';
import { decodeCommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type { RoomSkill } from '@cardstack/host/resources/room';

import type CommandService from '@cardstack/host/services/command-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import type { CommandStatus } from 'https://cardstack.com/base/command';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';
import type {
  CardMessageContent,
  CardMessageEvent,
  CodePatchResultEvent,
  DebugMessageEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
} from 'https://cardstack.com/base/matrix-event';
import type { Skill } from 'https://cardstack.com/base/skill';

import { Message } from './message';
import MessageCodePatchResult from './message-code-patch-result';
import MessageCommand from './message-command';

import type { RoomMember } from './member';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

export default class MessageBuilder {
  constructor(
    private event: MessageEvent | CardMessageEvent | DebugMessageEvent,
    owner: Owner,
    private builderContext: {
      roomId: string;
      effectiveEventId: string;
      author: RoomMember;
      index: number;
      skills: RoomSkill[];
      events: DiscreteMatrixEvent[];
      codePatchResultEvent?: CodePatchResultEvent;
      commandResultEvent?: CommandResultEvent;
    },
  ) {
    setOwner(this, owner);
  }

  @service declare private commandService: CommandService;
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  private get coreMessageArgs() {
    return new Message({
      roomId: this.builderContext.roomId,
      author: this.builderContext.author,
      agentId: (this.event.content as CardMessageContent)?.data?.context
        ?.agentId,
      created: new Date(this.event.origin_server_ts),
      updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
      body: this.event.content.body,
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
      hasContinuation: hasContinuation(this.event),
      continuationOf: isCardMessageEvent(this.event)
        ? (this.event.content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] ?? null)
        : null,
    });
  }

  get clientGeneratedId() {
    return (this.event.content as CardMessageContent).clientGeneratedId;
  }

  get attachedCardIds() {
    let content = this.event.content as CardMessageContent;
    let attachedCardIds: string[] = [];
    if (content.data?.attachedCards) {
      attachedCardIds = content.data.attachedCards
        .map((c) => c.sourceUrl)
        .filter(Boolean);
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

  get attachedCardsAsFiles() {
    return (this.event.content as CardMessageContent).data?.attachedCards?.map(
      (card) => this.matrixService.fileAPI.createFileDef(card),
    );
  }

  async buildMessage(): Promise<Message> {
    let { event } = this;
    let message = this.coreMessageArgs;
    message.errorMessage = this.errorMessage;
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      message.clientGeneratedId = this.clientGeneratedId;
      message.setIsStreamingFinished(!!event.content.isStreamingFinished);
      message.setIsCanceled(!!event.content.isCanceled);
      message.attachedCardIds = this.attachedCardIds;
      message.attachedCardsAsFiles = this.attachedCardsAsFiles;
      if (event.content[APP_BOXEL_COMMAND_REQUESTS_KEY]) {
        message.setCommands(await this.buildMessageCommands(message));
      }
      message.codePatchResults = this.buildMessageCodePatchResults(message);
    } else if (event.content.msgtype === 'm.text') {
      message.setIsStreamingFinished(!!event.content.isStreamingFinished);
      message.setIsCanceled(!!event.content.isCanceled);
    }
    if (event.type === APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE) {
      message.isDebugMessage = true;
    }

    return message;
  }

  async updateMessage(message: Message) {
    if (message.created.getTime() > this.event.origin_server_ts) {
      message.created = new Date(this.event.origin_server_ts);
      return;
    }

    message.setBody(this.event.content.body);
    message.setReasoningContent(
      (this.event.content as CardMessageContent)[
        APP_BOXEL_REASONING_CONTENT_KEY
      ] || null,
    );
    message.setIsStreamingFinished(
      'isStreamingFinished' in this.event.content
        ? this.event.content.isStreamingFinished
        : undefined,
    );
    message.setIsCanceled(
      'isCanceled' in this.event.content
        ? this.event.content.isCanceled
        : undefined,
    );
    message.hasContinuation = hasContinuation(this.event);
    message.continuationOf = isCardMessageEvent(this.event)
      ? (this.event.content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY] ?? null)
      : null;
    message.setUpdated(new Date());
    message.errorMessage = this.errorMessage;

    let encodedCommandRequests =
      (this.event.content as CardMessageContent)[
        APP_BOXEL_COMMAND_REQUESTS_KEY
      ] ?? [];
    for (let encodedCommandRequest of encodedCommandRequests) {
      let command = message.commands.find(
        (c) => c.commandRequest.id === encodedCommandRequest.id,
      );
      if (command) {
        command.commandRequest = decodeCommandRequest(encodedCommandRequest);
      } else {
        message.commands.push(
          await this.buildMessageCommand(
            message,
            decodeCommandRequest(encodedCommandRequest),
          ),
        );
      }
    }
  }

  async updateMessageCommandResult(message: Message) {
    if (message.commands.length === 0) {
      message.setCommands(await this.buildMessageCommands(message));
    }

    if (this.builderContext.commandResultEvent && message.commands.length > 0) {
      let event = this.builderContext.commandResultEvent;
      if (
        event.content.msgtype ===
          APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE ||
        event.content.msgtype ===
          APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE
      ) {
        let commandRequestId = event.content.commandRequestId;
        let messageCommand = message.commands.find(
          (c) => c.commandRequest.id === commandRequestId,
        );
        if (messageCommand) {
          messageCommand.commandStatus = event.content['m.relates_to']
            .key as CommandStatus;
          messageCommand.commandResultFileDef =
            event.content.msgtype ===
            APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
              ? event.content.data.card
              : undefined;
          messageCommand.failureReason = event.content.failureReason;
        }
      }
    }
  }

  updateMessageCodePatchResult(message: Message) {
    message.codePatchResults = this.buildMessageCodePatchResults(message);
  }

  private async buildMessageCommands(message: Message) {
    let eventContent = this.event.content as CardMessageContent;
    let commandRequests = eventContent[APP_BOXEL_COMMAND_REQUESTS_KEY];
    if (!commandRequests) {
      return new TrackedArray<MessageCommand>();
    }
    let commands = new TrackedArray<MessageCommand>();
    for (let commandRequest of commandRequests) {
      let command = await this.buildMessageCommand(
        message,
        decodeCommandRequest(commandRequest),
      );
      commands.push(command);
    }
    return commands;
  }

  private async buildMessageCommand(
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
      let skillCard = await this.store.get<Skill>(skill.cardId);
      if (!skillCard || !isCardInstance(skillCard)) {
        continue;
      }
      for (let candidateSkillCommand of skillCard.commands) {
        if (commandRequest.name === candidateSkillCommand.functionName) {
          skillCommand = candidateSkillCommand;
          break findCommand;
        }
      }
    }

    let actionVerb = 'Apply';
    if (skillCommand?.codeRef) {
      let CommandKlass = (await getClass(
        skillCommand?.codeRef,
        this.loaderService.loader,
      )) as { actionVerb: string };
      if (CommandKlass?.actionVerb) {
        actionVerb = CommandKlass.actionVerb;
      }
    }

    let messageCommand = new MessageCommand(
      message,
      commandRequest,
      skillCommand?.codeRef,
      this.builderContext.effectiveEventId,
      skillCommand?.requiresApproval ?? true,
      actionVerb,
      (commandResultEvent?.content['m.relates_to']?.key ||
        'ready') as CommandStatus,
      commandResultEvent?.content.msgtype ===
      APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
        ? commandResultEvent.content.data.card
        : undefined,
      getOwner(this)!,
      commandResultEvent?.content.failureReason,
    );
    return messageCommand;
  }

  private buildMessageCodePatchResults(message: Message) {
    let codePatchResultEvents = this.builderContext.events.filter((e: any) => {
      let r = e.content['m.relates_to'];
      if (!r) {
        return false;
      }
      return (
        e.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        r.rel_type === APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        r.event_id === message.eventId
      );
    }) as CodePatchResultEvent[];

    let codePatchResults = new TrackedArray<MessageCodePatchResult>();
    for (let codePatchResultEvent of codePatchResultEvents) {
      let finalFileUrlAfterCodePatching =
        codePatchResultEvent.content.data.attachedFiles?.[0]?.sourceUrl;
      let originalUploadedFileUrl =
        codePatchResultEvent.content.data.attachedFiles?.[0]?.url;
      if (!finalFileUrlAfterCodePatching) {
        console.error(
          'Bug: no final file url found for code patch result event - it should have been set',
          codePatchResultEvent,
        );
        continue;
      }
      if (!originalUploadedFileUrl) {
        console.error(
          'Bug: no original uploaded file url found for code patch result event - it should have been set',
          codePatchResultEvent,
        );
        continue;
      }

      codePatchResults.push(
        new MessageCodePatchResult(
          message,
          this.builderContext.effectiveEventId,
          codePatchResultEvent.content['m.relates_to'].key,
          codePatchResultEvent.content.codeBlockIndex,
          finalFileUrlAfterCodePatching,
          originalUploadedFileUrl,
          getOwner(this)!,
          codePatchResultEvent.content.failureReason,
        ),
      );
    }
    return codePatchResults;
  }
}

export function isCardMessageEvent(
  matrixEvent: DiscreteMatrixEvent,
): matrixEvent is CardMessageEvent {
  if (matrixEvent.type === APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE) {
    return true;
  }
  if (matrixEvent.type !== 'm.room.message') {
    return false;
  }
  if (!matrixEvent.content) {
    return false;
  }
  return matrixEvent.content?.msgtype === APP_BOXEL_MESSAGE_MSGTYPE;
}

function hasContinuation(matrixEvent: DiscreteMatrixEvent) {
  return (
    isCardMessageEvent(matrixEvent) &&
    matrixEvent.content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY] === true
  );
}
