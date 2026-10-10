import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { service } from '@ember/service';

import { TrackedArray } from 'tracked-built-ins';

import { type ResolvedCodeRef, getClass } from '@cardstack/runtime-common';

import type { ToolRequest } from '@cardstack/runtime-common/commands';
import {
  AI_BOT_EXECUTOR,
  decodeToolRequest,
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
import MessageTool, {
  type NeverAutoExecutesFor,
  type ToolResolution,
} from './message-tool';

import type { RoomMember } from './member';
import type { ToolCallStatus } from '@cardstack/base/command';
import type { SerializedFile } from '@cardstack/base/file-api';
import type {
  CardMessageContent,
  CardMessageEvent,
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
      usage: (this.event.content as CardMessageContent)?.data?.usage,
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

  get typedByUser() {
    let data: unknown = (this.event.content as CardMessageContent).data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return false;
      }
    }
    return (data as CardMessageContent['data'])?.context?.typedByUser === true;
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

  buildMessage(): Message {
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
      message.typedByUser = this.typedByUser;
      message.setIsStreamingFinished(!!event.content.isStreamingFinished);
      message.setIsCanceled(!!event.content.isCanceled);
      message.reloadBillingData = shouldReloadBillingData(event.content);
      message.attachedCardIds = this.attachedCardIds;
      message.attachedCardsAsFiles = this.attachedCardsAsFiles;
      if (getToolRequests(event.content)) {
        message.setTools(this.buildMessageCommands(message));
      }
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

  updateMessage(message: Message) {
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
    // The token counts arrive on a late edit — the one that completes the
    // answer, or a follow-up edit when the counts trailed it. Earlier edits
    // don't carry them, so only ever set, never clear.
    let usage = (this.event.content as CardMessageContent)?.data?.usage;
    if (usage) {
      message.setUsage(usage);
    }
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
      let command = message.tools.find(
        (c) => c.toolRequest.id === encodedCommandRequest.id,
      );
      if (command) {
        this.applyToolRequestChunk(command, encodedCommandRequest);
      } else {
        let built = this.buildMessageCommand(
          message,
          decodeToolRequest(encodedCommandRequest),
        );
        built.toolRequestEventTs = this.event.origin_server_ts;
        message.tools.push(built);
      }
    }
  }

  updateMessageCommandResult(message: Message) {
    if (message.tools.length === 0) {
      message.setTools(this.buildMessageCommands(message));
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
          let toolResultFileDef = isToolResultWithOutputContent(event.content)
            ? event.content.data.card
            : undefined;
          // Room processing replays every event on each pass. Assigning the
          // same result file again would still invalidate the tracked field
          // and restart the result card's load, so assign only a new file.
          if (messageTool.toolResultFileDef?.url !== toolResultFileDef?.url) {
            messageTool.toolResultFileDef = toolResultFileDef;
          }
          messageTool.failureReason = event.content.failureReason;
        }
      }
    }
  }

  // Builder passes finishing out of order must not regress a MessageTool's
  // request to an older event's chunk — validation and auto-execution would
  // then run against stale arguments. Apply a chunk only when its event is
  // at least as new as the one that last wrote the request.
  private applyToolRequestChunk(
    tool: MessageTool,
    encodedToolRequest: Partial<EncodedToolRequest>,
  ) {
    if (this.event.origin_server_ts < tool.toolRequestEventTs) {
      return;
    }
    tool.toolRequest = decodeToolRequest(encodedToolRequest);
    tool.toolRequestEventTs = this.event.origin_server_ts;
    // The first chunk can carry a name that is not complete yet; resolve the
    // tool again for the name it has now (a no-op when the name is
    // unchanged). Once the request is finished, a call nothing has answered
    // that resolved to no command is resolved again too: the skill declaring
    // it may have loaded since. Every tab does this, not only the one whose
    // drain validates the call, so the pill and a manual run see the command.
    let finished = !!(this.event.content as CardMessageContent)
      .isStreamingFinished;
    tool
      .resolve({
        retryUnresolved: finished && tool.toolCallStatus === 'ready',
      })
      .catch(() => {
        // Recorded on the tool; the tool drain retries when it validates.
      });
  }

  private buildMessageCommands(message: Message) {
    let eventContent = this.event.content as CardMessageContent;
    let toolRequests =
      getToolRequests<Partial<EncodedToolRequest>>(eventContent);
    let commands = new TrackedArray<MessageTool>();
    if (!toolRequests) {
      return commands;
    }
    for (let toolRequest of toolRequests) {
      // Same guard as updateMessage: a request chunk without an id yet
      // can't be matched to later chunks or to its result, so building it
      // would strand a permanently-unresolved MessageTool. This path also
      // sees such chunks — e.g. a reload that makes the streaming edit the
      // first loaded event for the message.
      if (!toolRequest.id) {
        continue;
      }
      let command = this.buildMessageCommand(
        message,
        decodeToolRequest(toolRequest),
      );
      command.toolRequestEventTs = this.event.origin_server_ts;
      commands.push(command);
    }
    return commands;
  }

  private buildMessageCommand(
    message: Message,
    toolRequest: Partial<ToolRequest>,
  ) {
    let toolResultEvent = this.builderContext.toolResultEvent;
    if (!toolResultEvent) {
      // Correlate the result to its command by commandRequestId (the
      // globally unique LLM tool-call id), not by the result's
      // m.relates_to.event_id. A reload strips the m.replace edits and loads
      // only the original event, so the result's link id — pointing at the
      // final edit — matches no loaded event. commandRequestId is stable
      // across edits and present on every one, so it resolves the command on
      // both the live and reload paths.
      //
      // Scan newest-first: a request can have several result events (a
      // 'failed' first attempt, an 'applied' retry) and the latest one is
      // the call's actual outcome.
      let events = this.builderContext.events;
      for (let i = events.length - 1; i >= 0; i--) {
        let e = events[i] as any;
        let r = e.content?.['m.relates_to'];
        if (
          isToolResultEventType(e.type) &&
          isToolResultRelType(r?.rel_type) &&
          e.content.commandRequestId === toolRequest.id
        ) {
          toolResultEvent = e as ToolResultEvent;
          break;
        }
      }
    }

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
        false, // requiresApproval — the host never runs it
        // The only button a bot-run call can show is the approval of a call
        // ai-bot holds for it (see MessageTool.awaitsApproval).
        'Approve',
        (toolResultEvent
          ? toolResultEvent.content['m.relates_to']?.key || 'applied'
          : 'applying') as ToolCallStatus,
        undefined, // no result card (server-handled results carry no output)
        getOwner(this)!,
        toolResultEvent?.content.failureReason,
      );
    }

    let toolCallStatus: ToolCallStatus = (toolResultEvent?.content[
      'm.relates_to'
    ]?.key || 'ready') as ToolCallStatus;

    // The tool is created now, from the request alone; resolving its command
    // awaits network loads and happens on the tool itself (see
    // MessageTool.resolve), so the message's tool list is complete as soon as
    // its event is applied.
    return new MessageTool(
      message,
      toolRequest,
      undefined,
      this.builderContext.effectiveEventId,
      true,
      'Apply',
      toolCallStatus,
      toolResultEvent && isToolResultWithOutputContent(toolResultEvent.content)
        ? toolResultEvent.content.data.card
        : undefined,
      getOwner(this)!,
      toolResultEvent?.content.failureReason,
      false,
      undefined,
      (request) => this.resolveTool(request),
    );
  }

  // Resolves a host tool's command from its name: the enabled skills first,
  // then a skill the model discovered the tool in. Reads the room's skills and
  // events when it runs, not when the tool was built: the skills may have
  // finished loading, or the discovering result arrived, since.
  private async resolveTool(
    toolRequest: Partial<ToolRequest>,
  ): Promise<ToolResolution> {
    let roomResource = this.matrixService.roomResources.get(
      this.builderContext.roomId,
    );
    let skills = roomResource?.skills ?? this.builderContext.skills;
    let events = roomResource?.events ?? this.builderContext.events;

    // Find command in skills. loadSkillSource handles both legacy Skill
    // cards and markdown skills (tools in boxel.tools frontmatter).
    let skillTool:
      | { codeRef: ResolvedCodeRef; requiresApproval: boolean }
      | undefined;
    findCommand: for (let skill of skills) {
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
      let sourceSkillUrl = findDiscoveredToolSkillUrl(events, toolRequest.name);
      if (sourceSkillUrl) {
        // The URL comes from a bot event, so a load blowing up on a
        // malformed or unreadable id degrades to "unresolved tool", which
        // validation reports through the unrecognized-command path.
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
    let neverAutoExecutes = false;
    let neverAutoExecutesFor: NeverAutoExecutesFor | undefined;
    if (skillTool?.codeRef) {
      let CommandKlass = (await getClass(
        skillTool?.codeRef,
        this.loaderService.loader,
      )) as {
        actionVerb?: string;
        neverAutoExecutes?: boolean;
        neverAutoExecutesFor?: NeverAutoExecutesFor;
      };
      if (CommandKlass?.actionVerb) {
        actionVerb = CommandKlass.actionVerb;
      }
      neverAutoExecutes = CommandKlass?.neverAutoExecutes === true;
      if (typeof CommandKlass?.neverAutoExecutesFor === 'function') {
        neverAutoExecutesFor =
          CommandKlass.neverAutoExecutesFor.bind(CommandKlass);
      }
    }

    return {
      codeRef: skillTool?.codeRef,
      requiresApproval: skillTool?.requiresApproval ?? true,
      actionVerb,
      neverAutoExecutes,
      neverAutoExecutesFor,
    };
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
