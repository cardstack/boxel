import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { service } from '@ember/service';

import { TrackedArray } from 'tracked-built-ins';

import { type ResolvedCodeRef, getClass } from '@cardstack/runtime-common';

import type { ToolRequest } from '@cardstack/runtime-common/commands';
import {
  AI_BOT_EXECUTOR,
  decodeCommandRequest,
} from '@cardstack/runtime-common/commands';
import {
  getToolRequests,
  isToolResultEventType,
  isToolResultRelType,
  isToolResultWithNoOutputMsgtype,
  isToolResultWithOutputContent,
  isToolResultWithOutputMsgtype,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_RELOAD_BILLING_DATA_KEY,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  findDiscoveredToolSkillUrl,
  getSkillSourceTools,
  loadSkillSource,
} from '@cardstack/host/lib/skill-tools';
import type { RoomSkill } from '@cardstack/host/resources/room';

import type LoaderService from '@cardstack/host/services/loader-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';

import { Message } from './message';
import MessageCodePatchResult from './message-code-patch-result';
import MessageTool from './message-tool';

import type { RoomMember } from './member';
import type { ToolCallStatus } from '@cardstack/base/command';
import type { SerializedFile } from '@cardstack/base/file-api';
import type {
  CardMessageContent,
  CardMessageEvent,
  CodePatchResultEvent,
  DebugMessageEvent,
  ToolResultEvent,
  EncodedToolRequest,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
} from '@cardstack/base/matrix-event';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

function shouldReloadBillingData(content: object) {
  return Boolean(
    (content as { [APP_BOXEL_RELOAD_BILLING_DATA_KEY]?: boolean })[
      APP_BOXEL_RELOAD_BILLING_DATA_KEY
    ],
  );
}

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
      toolResultEvent?: ToolResultEvent;
    },
  ) {
    setOwner(this, owner);
  }

  @service declare private toolService: ToolService;
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
    message.isCodePatchCorrectness =
      event.content.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE;
    if (
      event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
      event.content.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
    ) {
      message.clientGeneratedId = this.clientGeneratedId;
      message.setIsStreamingFinished(!!event.content.isStreamingFinished);
      message.setIsCanceled(!!event.content.isCanceled);
      message.reloadBillingData = shouldReloadBillingData(event.content);
      message.attachedCardIds = this.attachedCardIds;
      message.attachedCardsAsFiles = this.attachedCardsAsFiles;
      if (getToolRequests(event.content)) {
        message.setTools(await this.buildMessageCommands(message));
      }
      message.codePatchResults = this.buildMessageCodePatchResults(message);
    } else if (event.content.msgtype === 'm.text') {
      message.setIsStreamingFinished(!!event.content.isStreamingFinished);
      message.setIsCanceled(!!event.content.isCanceled);
      message.reloadBillingData = shouldReloadBillingData(event.content);
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
    message.status = this.event.status;
    message.errorMessage = this.errorMessage;
    message.reloadBillingData = shouldReloadBillingData(this.event.content);

    // Refresh attached card/file metadata so an optimistic synthetic — which
    // names attached cards from URL slugs alone — gets its names/types
    // replaced by the real echo's serialized FileDef shape (title-cased,
    // proper contentType, etc.) without re-creating the Message instance.
    if (
      this.event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
      this.event.content.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
    ) {
      message.attachedCardIds = this.attachedCardIds;
      message.attachedCardsAsFiles = this.attachedCardsAsFiles;
      message.attachedFiles = this.attachedFiles;
    }

    let encodedCommandRequests =
      getToolRequests<Partial<EncodedToolRequest>>(
        this.event.content as CardMessageContent,
      ) ?? [];
    for (let encodedCommandRequest of encodedCommandRequests) {
      // A request without an id yet (its first streamed chunk) can't be
      // matched to later chunks or to its result — skip it; a later replace
      // always carries the id.
      if (!encodedCommandRequest.id) {
        continue;
      }
      let decoded = decodeCommandRequest(encodedCommandRequest);
      // Streamed arguments only ever grow, and only parse once complete — a
      // request whose arguments have parsed is strictly newer than one whose
      // haven't. Never let an older pass (e.g. one that just finished
      // awaiting a slow build) downgrade a request that already carries
      // arguments back to a partial one.
      let downgrades = (current: Partial<ToolRequest>) =>
        current.arguments != null && decoded.arguments == null;
      let command = message.tools.find(
        (c) => c.toolRequest.id === encodedCommandRequest.id,
      );
      if (command) {
        if (!downgrades(command.toolRequest)) {
          command.toolRequest = decoded;
        }
      } else {
        let built = await this.buildMessageCommand(message, decoded);
        // buildMessageCommand awaits network loads (resolving the tool's
        // declaring skill), so a concurrent build for a later replace of the
        // same message can land first. Re-check before pushing: a duplicate
        // MessageTool for the same request would never receive its result
        // (results attach to the first match) and would spin forever.
        let existing = message.tools.find(
          (c) => c.toolRequest.id === encodedCommandRequest.id,
        );
        if (existing) {
          if (!downgrades(existing.toolRequest)) {
            existing.toolRequest = decoded;
          }
        } else {
          message.tools.push(built);
        }
      }
    }
  }

  async updateMessageCommandResult(message: Message) {
    if (message.tools.length === 0) {
      message.setTools(await this.buildMessageCommands(message));
    }

    if (this.builderContext.toolResultEvent && message.tools.length > 0) {
      let event = this.builderContext.toolResultEvent;
      if (
        isToolResultWithOutputMsgtype(event.content.msgtype) ||
        isToolResultWithNoOutputMsgtype(event.content.msgtype)
      ) {
        let commandRequestId = event.content.commandRequestId;
        let messageTool = message.tools.find(
          (c) => c.toolRequest.id === commandRequestId,
        );
        if (messageTool) {
          messageTool.toolCallStatus = event.content['m.relates_to']
            .key as ToolCallStatus;
          messageTool.toolResultFileDef = isToolResultWithOutputContent(
            event.content,
          )
            ? event.content.data.card
            : undefined;
          messageTool.failureReason = event.content.failureReason;
        }
      }
    }
  }

  updateMessageCodePatchResult(message: Message) {
    message.codePatchResults = this.buildMessageCodePatchResults(message);
  }

  private async buildMessageCommands(message: Message) {
    let eventContent = this.event.content as CardMessageContent;
    let toolRequests =
      getToolRequests<Partial<EncodedToolRequest>>(eventContent);
    if (!toolRequests) {
      return new TrackedArray<MessageTool>();
    }
    let commands = new TrackedArray<MessageTool>();
    for (let toolRequest of toolRequests) {
      let command = await this.buildMessageCommand(
        message,
        decodeCommandRequest(toolRequest),
      );
      commands.push(command);
    }
    return commands;
  }

  private async buildMessageCommand(
    message: Message,
    toolRequest: Partial<ToolRequest>,
  ) {
    let toolResultEvent =
      this.builderContext.toolResultEvent ??
      (this.builderContext.events.find((e: any) => {
        let r = e.content['m.relates_to'];
        // Correlate the result to its command by commandRequestId (the
        // globally unique LLM tool-call id), not by the result's
        // m.relates_to.event_id. A reload strips the m.replace edits and loads
        // only the original event, so the result's link id — pointing at the
        // final edit — matches no loaded event. commandRequestId is stable
        // across edits and present on every one, so it resolves the command on
        // both the live and reload paths.
        return (
          isToolResultEventType(e.type) &&
          isToolResultRelType(r?.rel_type) &&
          e.content.commandRequestId === toolRequest.id
        );
      }) as ToolResultEvent | undefined);

    // ai-bot ran this one itself (e.g. readRealmFile), so the host never
    // resolves a command class or runs it. Skip the skill lookup below — it's
    // pure async churn here (an `await store.get` per enabled skill) that would
    // leave the indicator blank for a beat while it runs. Build the command
    // synchronously: 'applying' (loading) until the result event lands, then
    // applied (success) or invalid + reason (failure).
    if (toolRequest.executedBy === AI_BOT_EXECUTOR) {
      return new MessageTool(
        message,
        toolRequest,
        undefined, // no codeRef — never run on the host
        this.builderContext.effectiveEventId,
        false, // requiresApproval — never prompts or runs
        'Apply', // actionVerb — unused; the indicator shows status, not a Run button
        (toolResultEvent
          ? toolResultEvent.content['m.relates_to']?.key || 'applied'
          : 'applying') as ToolCallStatus,
        undefined, // no result card (server-handled results carry no output)
        getOwner(this)!,
        toolResultEvent?.content.failureReason,
      );
    }

    // Find command in skills. loadSkillSource handles both legacy Skill
    // cards and markdown skills (tools in boxel.tools frontmatter).
    let skillTool:
      | { codeRef: ResolvedCodeRef; requiresApproval: boolean }
      | undefined;
    findCommand: for (let skill of this.builderContext.skills) {
      let source = await loadSkillSource(this.store, skill.cardId);
      if (!source) {
        continue;
      }
      for (let candidateSkillTool of getSkillSourceTools(source)) {
        if (toolRequest.name === candidateSkillTool.functionName) {
          skillTool = candidateSkillTool;
          break findCommand;
        }
      }
    }

    // Tool from a read (not enabled) skill: the model may call a tool it
    // discovered by reading a skill file via readRealmFile. The bot's result
    // event names the declaring skill, but that annotation is strictly a
    // lookup hint, never an authorization — the codeRef the host executes is
    // re-derived here from the skill's realm-indexed frontmatter, loaded
    // through the store with the user's own permissions. A forged annotation
    // can't execute anything the named skill doesn't declare, and a skill the
    // user can't read resolves nothing; either way the tool stays unresolved
    // and surfaces through the existing unrecognized-command failure path.
    // `requiresApproval` likewise comes from the verified declaration (absent
    // means approval required), exactly as for enabled skills.
    if (!skillTool && toolRequest.name) {
      let sourceSkillUrl = findDiscoveredToolSkillUrl(
        this.builderContext.events,
        toolRequest.name,
      );
      if (sourceSkillUrl) {
        // The URL comes from a bot event, so a load blowing up on a
        // malformed or unreadable id must degrade to "unresolved tool", not
        // break message building for the whole timeline.
        try {
          let source = await loadSkillSource(this.store, sourceSkillUrl);
          if (source) {
            skillTool = getSkillSourceTools(source).find(
              (candidate) => candidate.functionName === toolRequest.name,
            );
          }
        } catch (e) {
          console.warn(
            `could not load skill ${sourceSkillUrl} to resolve tool "${toolRequest.name}":`,
            e,
          );
        }
      }
    }

    let actionVerb = 'Apply';
    if (skillTool?.codeRef) {
      let CommandKlass = (await getClass(
        skillTool?.codeRef,
        this.loaderService.loader,
      )) as { actionVerb: string };
      if (CommandKlass?.actionVerb) {
        actionVerb = CommandKlass.actionVerb;
      }
    }

    let requiresApproval = skillTool?.requiresApproval ?? true;

    let toolCallStatus: ToolCallStatus = (toolResultEvent?.content[
      'm.relates_to'
    ]?.key || 'ready') as ToolCallStatus;

    let messageTool = new MessageTool(
      message,
      toolRequest,
      skillTool?.codeRef,
      this.builderContext.effectiveEventId,
      requiresApproval,
      actionVerb,
      toolCallStatus,
      toolResultEvent && isToolResultWithOutputContent(toolResultEvent.content)
        ? toolResultEvent.content.data.card
        : undefined,
      getOwner(this)!,
      toolResultEvent?.content.failureReason,
    );
    return messageTool;
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
  return (
    matrixEvent.content?.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
    matrixEvent.content?.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
  );
}

function hasContinuation(matrixEvent: DiscreteMatrixEvent) {
  return (
    isCardMessageEvent(matrixEvent) &&
    matrixEvent.content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY] === true
  );
}
