import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { difference } from 'lodash-es';

import { TrackedMap } from 'tracked-built-ins';

import {
  isCardInstance,
  logger,
  rri,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { ToolRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  LEGACY_APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  getToolRequests,
  isToolResultRelType,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_LLM_MODE,
  DEFAULT_FALLBACK_MODEL_ID,
  type AppBoxelResponseStreamContent,
  type LLMMode,
} from '@cardstack/runtime-common/matrix-constants';

import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import {
  getSkillSourceTools,
  isMarkdownSkillId,
  loadSkillSource,
  peekSkillSource,
} from '../lib/skill-tools';

import type { Message } from '../lib/matrix-classes/message';

import type Room from '../lib/matrix-classes/room';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type { SerializedFile } from '@cardstack/base/file-api';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  RoomCreateEvent,
  RoomNameEvent,
  InviteEvent,
  JoinEvent,
  LeaveEvent,
  CardMessageEvent,
  DebugMessageEvent,
  MessageEvent,
  ToolResultEvent,
  RealmServerEvent,
  CodePatchResultEvent,
  ActiveLLMEvent,
} from '@cardstack/base/matrix-event';
import type { Skill } from '@cardstack/base/skill';
import type { TaskInstance } from 'ember-concurrency';
import type { IRoomEvent } from 'matrix-js-sdk';

export type RoomSkill = {
  cardId: string;
  realmURL: string | undefined;
  fileDef: SerializedFile;
  isActive: boolean;
};

const responseStreamLog = logger('matrix:response-stream');

interface Args {
  named: {
    roomId: string | undefined;
    // Reactivity hook only — RoomResource never reads this. Returning whatever
    // tracked deps the caller wants the resource to invalidate on (e.g. events
    // alone, or [events, hasRoomState]) is sufficient. See CS-6987.
    deps: unknown;
  };
}

export class RoomResource extends Resource<Args> {
  #skillIds = new Set<string>();
  #hasRegisteredDestructor = false;
  #responseStreamPreviewDisposer: (() => void) | undefined;
  // Highest to-device preview `sequence` applied per streaming message
  // (keyed by parentEventId). Previews carry full accumulated state, so an
  // out-of-order or duplicate delivery is simply dropped rather than regressing
  // the message to older content. Both maps are pruned when a message finalizes
  // (see hydrateResponseStreamPreview) and cleared in teardown().
  #lastPreviewSequence = new Map<string, number>();
  // Serializes preview applies per streaming message so their async tool-request
  // builds land in sequence order rather than promise-completion order.
  #previewApplyChain = new Map<string, Promise<void>>();
  private _messageCache: TrackedMap<string, Message> = new TrackedMap();
  private _nameEventsCache: TrackedMap<string, RoomNameEvent> =
    new TrackedMap();
  @tracked private _createEvent: RoomCreateEvent | undefined;
  private _memberCache: TrackedMap<string, RoomMember> = new TrackedMap();
  private _isDisplayingViewCodeMap: TrackedMap<string, boolean> =
    new TrackedMap();
  @tracked matrixRoom: Room | undefined;
  @tracked processing: TaskInstance<void> | undefined;
  @tracked roomId: string | undefined;

  // To avoid delay, instead of using `roomResource.activeLLM`, we use a tracked property
  // that updates immediately after the user selects the LLM.
  @tracked private llmBeingActivated: string | undefined;
  @tracked private llmModeBeingActivated: LLMMode | undefined;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private toolService: ToolService;
  @service declare private store: StoreService;
  @service declare private realm: RealmService;

  modify(_positional: never[], named: Args['named']) {
    if (!named.roomId) {
      return;
    }
    this.roomId = named.roomId;
    this.processing = this.processRoomTask.perform(named.roomId);
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      this.#responseStreamPreviewDisposer =
        this.matrixService.onResponseStreamPreview((payload) =>
          this.hydrateResponseStreamPreview(payload),
        );
      registerDestructor(this, () => this.teardown());
    }
  }

  teardown() {
    this.processRoomTask.cancelAll();
    this.activateLLMTask.cancelAll();
    this.activateLLMModeTask.cancelAll();
    this.#responseStreamPreviewDisposer?.();
    this.#responseStreamPreviewDisposer = undefined;
    this.#lastPreviewSequence.clear();
    this.#previewApplyChain.clear();
    for (let id of this.#skillIds ?? []) {
      this.store.dropReference(id);
    }
    this.#skillIds.clear();
    this._messageCache.clear();
    this._nameEventsCache.clear();
    this._memberCache.clear();
    this._isDisplayingViewCodeMap.clear();
    this._createEvent = undefined;
    this.matrixRoom = undefined;
    this.processing = undefined;
    this.roomId = undefined;
    this.llmBeingActivated = undefined;
    this.llmModeBeingActivated = undefined;
  }

  get isProcessing() {
    return this.processRoomTask.isRunning;
  }

  processingLastStartedAt = 0;

  private processRoomTask = restartableTask(async (roomId: string) => {
    this.processingLastStartedAt = Date.now();
    try {
      this.matrixRoom = roomId
        ? await this.matrixService.getRoomData(roomId)
        : undefined; //look at the note in the EventSendingContext interface for why this is awaited
      if (!this.matrixRoom) {
        return;
      }
      let memberIds = this.matrixRoom.memberIds;
      // If the AI bot is not in the room, don't process the events
      if (!memberIds || !memberIds.includes(this.matrixService.aiBotUserId)) {
        return;
      }
      // TODO: enabledSkillCards can have references to skills whose URL
      // does not exist anymore (i.e. skill has been deleted or renamed). In
      // this case we should probably remove/update the reference from the skillConfig.
      // CS-8776
      try {
        await this.loadSkills(this.matrixRoom.skillsConfig.enabledSkillCards);
      } catch (e) {
        console.warn(`Failed to load skills: ${e}`);
      }

      let index = this._messageCache.size;
      // This is brought up to this level so if the
      // load task is rerun we can stop processing
      for (let event of this.sortedEvents) {
        switch (event.type) {
          case 'm.room.member':
            await this.loadRoomMemberEvent(roomId, event);
            break;
          case 'm.room.message':
            if (this.isRealmServerEvent(event)) {
              break;
            } else {
              await this.loadRoomMessage({
                roomId,
                event,
                index,
              });
            }
            break;
          case APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE:
            await this.loadRoomMessage({ roomId, event, index });
            break;
          case APP_BOXEL_TOOL_RESULT_EVENT_TYPE:
          case LEGACY_APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
            await this.updateMessageCommandResult({ roomId, event, index });
            break;
          case APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE:
            this.updateMessageCodePatchResult({
              roomId,
              codePatchResultEvent: event,
              index,
            });
            break;
          case 'm.room.create':
            await this.loadRoomCreateEvent(event);
            break;
          case 'm.room.name':
            await this.loadRoomNameEvent(event);
            break;
        }
        this.matrixService.cacheContentHashIfNeeded(event);
      }
    } catch (e) {
      throw new Error(`Error loading room ${e}`);
    }
  });

  // note that the arrays below recreated as they are recomputed and hence
  // different when the values change. downstream components that consume these
  // messages directly as args are unnecessarily re-created since they are
  // triple equals different when the values change. components should consume
  // something stable like this resource and not these ever changing arrays
  @cached
  get messages() {
    if (this.roomId == undefined) {
      return [];
    }
    return [...this._messageCache.values()]
      .filter((m) => m.roomId === this.roomId)
      .filter((m) => !m.continuationOf)
      .sort((a, b) => a.created.getTime() - b.created.getTime());
  }

  @cached
  get members() {
    if (this.roomId == undefined) {
      return [];
    }
    return (
      Array.from(this._memberCache.values()).filter(
        (m) => m.roomId === this.roomId,
      ) ?? []
    );
  }

  @cached
  get invitedMembers() {
    if (this.roomId == undefined) {
      return [];
    }
    return this.members.filter(
      (m) => m.membership === 'invite' && m.roomId === this.roomId,
    );
  }

  @cached
  get joinedMembers() {
    if (this.roomId == undefined) {
      return [];
    }
    return this.members.filter(
      (m) => m.membership === 'join' && m.roomId === this.roomId,
    );
  }

  get indexOfLastNonDebugMessage() {
    // We want to find the last message that is not a debug message
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].isDebugMessage !== true) {
        return i;
      }
    }
    return -1;
  }

  get events() {
    return this.matrixRoom?.events ?? [];
  }

  async waitForNextEvent() {
    return this.matrixRoom?.waitForNextEvent();
  }

  @cached
  private get sortedEvents() {
    return this.events.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  }

  private get allSkillFileDefs(): SerializedFile[] {
    let skillConfig = this.matrixRoom?.skillsConfig;
    if (
      !skillConfig ||
      !skillConfig.enabledSkillCards ||
      !skillConfig.disabledSkillCards
    ) {
      return [];
    }

    const enabledSkillCards = skillConfig.enabledSkillCards || [];
    const disabledSkillCards = skillConfig.disabledSkillCards || [];
    const uniqueCardsMap = new Map();

    for (const card of enabledSkillCards) {
      uniqueCardsMap.set(card.sourceUrl, card);
    }

    for (const card of disabledSkillCards) {
      if (!uniqueCardsMap.has(card.sourceUrl)) {
        uniqueCardsMap.set(card.sourceUrl, card);
      }
    }

    return Array.from(uniqueCardsMap.values());
  }

  get skills(): RoomSkill[] {
    let result: RoomSkill[] = [];

    for (let skillCard of this.allSkillFileDefs) {
      result.push({
        cardId: skillCard.sourceUrl,
        realmURL: this.realm.realmOf(rri(skillCard.sourceUrl)),
        fileDef: skillCard,
        isActive:
          this.matrixRoom?.skillsConfig.enabledSkillCards
            .map((enabledCard) => enabledCard.sourceUrl)
            .includes(skillCard.sourceUrl) ?? false,
      });
    }
    return result;
  }

  get tools() {
    // Usable tools are all tools on *active* skills, whether the skill is
    // a Skill card or a skill-bearing markdown file.
    let commands = [];
    for (let skill of this.skills) {
      if (!skill.isActive) {
        continue;
      }
      let skillSource = peekSkillSource(this.store, skill.cardId);
      if (skillSource) {
        commands.push(...getSkillSourceTools(skillSource));
      }
    }
    return commands;
  }

  @cached
  get created() {
    if (this._createEvent) {
      let d = new Date(this._createEvent.origin_server_ts);
      if (!isNaN(d.getTime())) {
        return d;
      }
    }
    // there is a race condition in the matrix SDK where newly created
    // rooms don't immediately have a created date
    return new Date();
  }

  get name() {
    return this.matrixRoom?.name;
  }

  @cached
  get lastActiveTimestamp() {
    let eventsWithTime = this.events.filter((t) => t.origin_server_ts);
    let maybeLastActive =
      eventsWithTime[eventsWithTime.length - 1]?.origin_server_ts;
    return maybeLastActive ?? this.created.getTime();
  }

  get activeLLM(): string {
    return (
      this.llmBeingActivated ?? this.resolveActiveLLMKey() ?? this.defaultLLM
    );
  }

  get activeInputModalities(): string[] | undefined {
    return this.matrixRoom?.activeInputModalities;
  }

  private resolveActiveLLMKey(): string | undefined {
    let eventContent = this.matrixRoom?.activeLLMEventContent;
    if (!eventContent?.model) {
      return undefined;
    }
    let systemCard = this.matrixService.systemCard;
    if (systemCard?.modelConfigurations) {
      let match = systemCard.modelConfigurations.find(
        (config) =>
          config.modelId === eventContent.model &&
          (config.reasoningEffort ?? undefined) ===
            (eventContent.reasoningEffort ?? undefined),
      );
      if (match?.id) {
        return match.id;
      }
      // Fall back to first config with matching modelId
      let fallbackMatch = systemCard.modelConfigurations.find(
        (config) => config.modelId === eventContent.model,
      );
      if (fallbackMatch?.id) {
        return fallbackMatch.id;
      }
    }
    return eventContent.model;
  }

  private get defaultLLM(): string {
    let systemCard = this.matrixService.systemCard;
    return (
      systemCard?.defaultModelConfiguration?.id ??
      systemCard?.modelConfigurations?.[0]?.id ??
      DEFAULT_FALLBACK_MODEL_ID
    );
  }

  @cached
  get usedLLMs(): string[] {
    let usedLLMs = new Set<string>();
    for (let event of this.events) {
      if (event.type === APP_BOXEL_ACTIVE_LLM) {
        let activeLLMEvent = event as ActiveLLMEvent;
        if (activeLLMEvent.content.model) {
          usedLLMs.add(activeLLMEvent.content.model);
        }
      }
    }
    return Array.from(usedLLMs);
  }

  get isActivatingLLM() {
    return this.activateLLMTask.isRunning;
  }

  activateLLMTask = restartableTask(async (key: string) => {
    await this.processing;
    if (this.activeLLM === key) {
      return;
    }
    this.llmBeingActivated = key;
    try {
      if (!this.matrixRoom) {
        throw new Error('matrixRoom is required to activate LLM');
      }

      // Resolve the key to a modelId and config properties
      let modelId = key;
      let config:
        | {
            toolsSupported?: boolean;
            reasoningEffort?: string;
            inputModalities?: string[];
          }
        | undefined;

      let systemCard = this.matrixService.systemCard;
      if (systemCard?.modelConfigurations) {
        let modelConfig = systemCard.modelConfigurations.find(
          (c) => c.id === key,
        );
        if (modelConfig?.modelId) {
          modelId = modelConfig.modelId;
          config = {
            toolsSupported: modelConfig.toolsSupported,
            reasoningEffort: modelConfig.reasoningEffort,
            inputModalities: modelConfig.inputModalities,
          };
        }
      }

      await this.matrixService.sendActiveLLMEvent(
        this.matrixRoom.roomId,
        modelId,
        config,
      );
      let remainingRetries = 20;
      while (this.matrixRoom.activeLLM !== modelId && remainingRetries > 0) {
        await timeout(50);
        remainingRetries--;
      }
      if (remainingRetries === 0) {
        throw new Error('Failed to activate LLM');
      }
    } finally {
      this.llmBeingActivated = undefined;
    }
  });

  get activeLLMMode(): LLMMode {
    return (
      this.llmModeBeingActivated ?? this.matrixRoom?.activeLLMMode ?? 'ask'
    );
  }

  @cached
  get llmModeEvents(): DiscreteMatrixEvent[] {
    return this.events.filter((event) => event.type === APP_BOXEL_LLM_MODE);
  }

  /**
   * Get the LLM mode that was active when a given message was created.
   *
   * Matrix `origin_server_ts` has millisecond resolution, so a message and a
   * mode transition can share a timestamp; a bare timestamp comparison cannot
   * tell whether such a transition happened just before or just after the
   * message. `sortedEvents` is a stable sort on `origin_server_ts`, so for
   * equal timestamps it preserves room (insertion) order. Walking it up to the
   * message and tracking the last mode transition seen yields the mode in
   * effect when the message arrived, regardless of same-millisecond ties.
   */
  getActiveLLMModeForMessage(messageEventId: string): LLMMode {
    let activeMode: LLMMode = 'ask';
    let foundMessage = false;
    for (let event of this.sortedEvents) {
      if (event.event_id === messageEventId) {
        foundMessage = true;
        break;
      }
      if (event.type === APP_BOXEL_LLM_MODE) {
        activeMode = (event as any).content?.mode ?? 'ask';
      }
    }
    // If the message isn't in the timeline yet, don't infer 'act' from later
    // transitions — fall back to 'ask' so a patch is never auto-applied on
    // incomplete data.
    if (!foundMessage) {
      return 'ask';
    }
    return activeMode;
  }

  get isActivatingLLMMode() {
    return this.activateLLMModeTask.isRunning;
  }

  activateLLMModeTask = restartableTask(async (mode: LLMMode) => {
    await this.processing;
    if (this.activeLLMMode === mode) {
      return;
    }
    this.llmModeBeingActivated = mode;
    try {
      if (!this.matrixRoom) {
        throw new Error('matrixRoom is required to activate LLM mode');
      }
      await this.matrixService.sendLLMModeEvent(this.matrixRoom.roomId, mode);
      let remainingRetries = 20;
      while (this.matrixRoom.activeLLMMode !== mode && remainingRetries > 0) {
        await timeout(50);
        remainingRetries--;
      }
      if (remainingRetries === 0) {
        throw new Error('Failed to activate LLM mode');
      }
    } finally {
      this.llmModeBeingActivated = undefined;
    }
  });

  private async loadRoomMemberEvent(
    roomId: string,
    event: InviteEvent | JoinEvent | LeaveEvent,
  ) {
    let userId = event.state_key;
    let roomMemberArgs = {
      userId,
      displayName: event.content.displayname,
      membership: event.content.membership,
      membershipDateTime: new Date(event.origin_server_ts) || Date.now(),
      membershipInitiator: event.sender,
    };
    this.upsertRoomMember({
      roomId,
      ...roomMemberArgs,
    });
  }

  private isRealmServerEvent(
    event: MessageEvent | CardMessageEvent | RealmServerEvent,
  ): event is RealmServerEvent {
    return event.content.msgtype === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE;
  }

  private async loadSkill(doc: LooseSingleCardDocument) {
    let cardId = doc.data.id;
    if (!cardId) {
      throw new Error(
        `SKill card document has no id, this should not happen: ${JSON.stringify(doc, null, 2)}`,
      );
    }
    let skillCard = await this.store.get<Skill>(cardId);
    if (isCardInstance(skillCard)) {
      return skillCard;
    } else {
      // A known reason for this is that the skill has been renamed
      return undefined;
    }
  }

  private async loadSkills(skillCardFileDefs: SerializedFile[]) {
    let skillIds: string[] = [];
    for (let skillCardFileDef of skillCardFileDefs) {
      if (isMarkdownSkillId(skillCardFileDef.sourceUrl)) {
        // A skill markdown file loads as a file-meta resource (not a card doc
        // downloaded from Matrix). Keep its instance in the store so the menu
        // pill renders and the room's usable commands resolve.
        let source = await loadSkillSource(
          this.store,
          skillCardFileDef.sourceUrl,
        );
        if (source) {
          skillIds.push(skillCardFileDef.sourceUrl);
        }
      } else {
        let cardDoc =
          await this.matrixService.downloadCardFileDef(skillCardFileDef);
        let skill = await this.loadSkill(cardDoc);
        if (skill?.id) {
          skillIds.push(skill.id);
        }
      }
    }
    let oldReferences = [...(this.#skillIds ?? [])];
    let newReferences = [...(skillIds ?? [])];
    this.#skillIds = new Set(skillIds);
    let referencesToDrop = difference(oldReferences, newReferences);
    for (let id of referencesToDrop) {
      this.store.dropReference(id);
    }
    let referencesToAdd = difference(newReferences, oldReferences);
    for (let id of referencesToAdd) {
      this.store.addReference(
        id,
        isMarkdownSkillId(id) ? { type: 'file-meta' } : undefined,
      );
    }
  }

  private getAggregatedReplacement(event: IRoomEvent) {
    let finalRawEvent;
    const originalEventId = event.event_id;
    let replacedRawEvent = event.unsigned?.['m.relations']?.['m.replace'];
    if (!event.content['m.relates_to']?.rel_type && replacedRawEvent) {
      finalRawEvent = replacedRawEvent;
      finalRawEvent.event_id = originalEventId;
    } else {
      finalRawEvent = event;
    }
    return finalRawEvent;
  }

  private async loadRoomMessage({
    roomId,
    event,
    index,
  }: {
    roomId: string;
    event: MessageEvent | CardMessageEvent | DebugMessageEvent;
    index: number;
  }) {
    let effectiveEventId = this.getEffectiveEventId(event);
    event = this.getAggregatedReplacement(event);

    let clientGeneratedId =
      'clientGeneratedId' in event.content
        ? event.content.clientGeneratedId
        : undefined;
    let message =
      this._messageCache.get(effectiveEventId) ??
      (clientGeneratedId
        ? this._messageCache.get(clientGeneratedId)
        : undefined);
    if (!message?.isStreamingOfEventFinished) {
      let author = this.upsertRoomMember({
        roomId,
        userId: event.sender,
      });
      let messageBuilder = new MessageBuilder(event, getOwner(this)!, {
        roomId,
        effectiveEventId,
        author,
        index,
        events: this.events,
        skills: this.skills,
      });

      if (!message) {
        message = await messageBuilder.buildMessage();
        this._messageCache.set(
          message.clientGeneratedId ?? effectiveEventId,
          message as any,
        );
      } else {
        await messageBuilder.updateMessage(message);
      }
    }

    if (message.continuationOf) {
      let continuedFromMessage = this._messageCache.get(message.continuationOf);
      if (continuedFromMessage) {
        continuedFromMessage.continuedInMessage = message;
      }
    }
  }

  // Hydrate an in-flight `app.boxel.response-stream` to-device preview (ai-bot
  // in AI_BOT_STREAMING_MODE=to-device) into the same Message the final room
  // edit will eventually reconcile. Shaping the preview as the CardMessage edit
  // it mirrors lets us reuse MessageBuilder.updateMessage — including its tool
  // request chunk merging — and its `setUpdated(new Date())` resets the
  // streaming stall timeout so long responses don't trip the fallback.
  //
  // This method gates an incoming preview (roomId / staleness / duplicate)
  // synchronously and then enqueues its apply on a per-message chain. The gate
  // must be synchronous: it decides ordering by arrival, and
  // applyResponseStreamPreview awaits async tool-request builds, so without
  // serialization two overlapping previews would resolve their tool args in
  // promise-completion order rather than sequence order (every synthetic event
  // pins the same origin_server_ts, so MessageBuilder.applyToolRequestChunk's
  // timestamp guard can't reorder them).
  private hydrateResponseStreamPreview(payload: AppBoxelResponseStreamContent) {
    if (!payload || payload.roomId !== this.roomId) {
      return;
    }
    let message = this._messageCache.get(payload.parentEventId);
    // Either the thinking placeholder this preview belongs to hasn't loaded
    // yet, or the turn already landed its final consolidated room edit. In both
    // cases the room-event path is authoritative and reconciles the true state,
    // so there is nothing for an ephemeral preview to add.
    if (!message || message.isStreamingOfEventFinished) {
      // Once the message is finalized its tracking entries are dead — prune
      // them opportunistically so a long-lived room doesn't accumulate one per
      // AI turn (teardown() is the backstop).
      if (message?.isStreamingOfEventFinished) {
        this.#lastPreviewSequence.delete(payload.parentEventId);
        this.#previewApplyChain.delete(payload.parentEventId);
      }
      return;
    }
    let lastSequence =
      this.#lastPreviewSequence.get(payload.parentEventId) ?? -1;
    if (payload.sequence <= lastSequence) {
      return;
    }
    this.#lastPreviewSequence.set(payload.parentEventId, payload.sequence);

    let previous =
      this.#previewApplyChain.get(payload.parentEventId) ?? Promise.resolve();
    let next = previous.then(() =>
      this.applyResponseStreamPreview(message, payload),
    );
    this.#previewApplyChain.set(payload.parentEventId, next);
  }

  private async applyResponseStreamPreview(
    message: Message,
    payload: AppBoxelResponseStreamContent,
  ) {
    try {
      let author = this.upsertRoomMember({
        roomId: payload.roomId,
        userId: this.matrixService.aiBotUserId,
      });
      // origin_server_ts is pinned to the message's creation time so a preview
      // never advances past — and thus never suppresses (see
      // MessageBuilder.applyToolRequestChunk) — the real, later final room edit.
      //
      // A preview intentionally owns only body / reasoning / toolRequests. The
      // other fields updateMessage writes (attachedCards/Files, continuationOf,
      // hasContinuation, status, reloadBillingData) are reset to empty/false on
      // every apply because the synthetic event doesn't carry them; that's
      // benign for a streaming response — the final room edit restores the truth
      // — but a placeholder that legitimately carried any of those would have it
      // wiped until finalization.
      let syntheticEvent = {
        type: 'm.room.message',
        event_id: payload.parentEventId,
        room_id: payload.roomId,
        sender: this.matrixService.aiBotUserId,
        origin_server_ts: message.created.getTime(),
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: payload.body,
          [APP_BOXEL_REASONING_CONTENT_KEY]: payload.reasoning,
          [APP_BOXEL_TOOL_REQUESTS_KEY]: payload.toolRequests,
          isStreamingFinished: false,
        },
      } as unknown as CardMessageEvent;

      let messageBuilder = new MessageBuilder(syntheticEvent, getOwner(this)!, {
        roomId: payload.roomId,
        effectiveEventId: payload.parentEventId,
        author,
        index: message.index ?? 0,
        events: this.events,
        skills: this.skills,
      });
      await messageBuilder.updateMessage(message);
    } catch (err) {
      // A dropped preview is harmless — the final room edit reconciles the true
      // state — so swallow (mirroring ai-bot's best-effort sendToDevicePreview)
      // rather than surface an unhandled rejection from this fire-and-forget
      // handler. updateMessage can throw when a new tool id triggers an async
      // skill/loader resolve.
      responseStreamLog.debug(
        `dropped response-stream preview (seq ${payload.sequence}) for ${payload.parentEventId}`,
        err,
      );
    }
  }

  private async updateMessageCommandResult({
    roomId,
    event,
    index,
  }: {
    roomId: string;
    event: ToolResultEvent;
    index: number;
  }) {
    // Locate the owning bot message by commandRequestId. The commandResult's
    // m.relates_to.event_id points at the latest m.replace edit, but a reload
    // strips those edits and loads only the original event, so matching on
    // event_id finds nothing and the status flip is lost. commandRequestId is
    // the globally-unique LLM tool-call id, stable across edits and present on
    // every one, so it resolves the same bot message on both the live and
    // reload paths.
    let messageEventWithCommand = this.events.find(
      (e: any) =>
        e.type === 'm.room.message' &&
        getToolRequests(e.content)?.some(
          (cr: any) => cr.id === event.content.commandRequestId,
        ),
    ) as CardMessageEvent | undefined;
    if (!messageEventWithCommand) {
      return;
    }
    // _messageCache is keyed by the bot message's effective/parent event_id —
    // getEffectiveEventId resolves an m.replace event back to its parent, so
    // when an m.replace Y of original X arrives loadRoomMessage keys the cache
    // by X. Derive the cache key from the bot-message event we just located
    // (messageEventWithCommand): for the m.replace event Y, getEffectiveEventId
    // returns parent X — which is what the cache holds.
    let messageCacheKey = this.getEffectiveEventId(messageEventWithCommand);
    let message = this._messageCache.get(messageCacheKey);
    if (!message) {
      return;
    }

    let author = this.upsertRoomMember({
      roomId,
      userId: event.sender,
    });
    let messageBuilder = new MessageBuilder(
      messageEventWithCommand,
      getOwner(this)!,
      {
        roomId,
        effectiveEventId: messageCacheKey,
        author,
        index,
        events: this.events,
        skills: this.skills,
        toolResultEvent: event,
      },
    );
    await messageBuilder.updateMessageCommandResult(message);
  }

  private updateMessageCodePatchResult({
    roomId,
    codePatchResultEvent,
    index,
  }: {
    roomId: string;
    codePatchResultEvent: CodePatchResultEvent;
    index: number;
  }) {
    let codePatchEventId =
      codePatchResultEvent.content['m.relates_to']?.event_id;
    let message = this._messageCache.get(codePatchEventId);
    if (!message) {
      return;
    }
    let codePatchEvent = this.events.find(
      (e: any) => e.event_i === codePatchEventId,
    ) as CardMessageEvent;
    let author = this.upsertRoomMember({
      roomId,
      userId: codePatchResultEvent.sender,
    });
    let messageBuilder = new MessageBuilder(codePatchEvent, getOwner(this)!, {
      roomId,
      effectiveEventId: codePatchEventId,
      author,
      index,
      events: this.events,
      skills: this.skills,
      codePatchResultEvent,
    });
    messageBuilder.updateMessageCodePatchResult(message);
  }

  private getEffectiveEventId(
    event:
      | MessageEvent
      | CardMessageEvent
      | ToolResultEvent
      | CodePatchResultEvent
      | DebugMessageEvent,
  ) {
    if (!('m.relates_to' in event.content)) {
      return event.event_id;
    }

    return event.content['m.relates_to']?.rel_type === 'm.replace' ||
      isToolResultRelType(event.content['m.relates_to']?.rel_type)
      ? event.content['m.relates_to'].event_id
      : event.event_id;
  }

  private async loadRoomNameEvent(event: RoomNameEvent) {
    if (!this._nameEventsCache.has(event.event_id)) {
      this._nameEventsCache.set(event.event_id, event);
    }
  }

  private async loadRoomCreateEvent(event: RoomCreateEvent) {
    this._createEvent = event;
  }

  private upsertRoomMember({
    roomId,
    userId,
    displayName,
    membership,
    membershipDateTime,
    membershipInitiator,
  }: RoomMemberInterface): RoomMember {
    let member: RoomMember | undefined;
    member = this._memberCache.get(userId);
    if (
      // Create new member if it doesn't exist or if provided data is more recent
      member?.membershipDateTime &&
      membershipDateTime &&
      member.membershipDateTime.getTime() > Number(membershipDateTime)
    ) {
      return member;
    }
    if (!member) {
      member = new RoomMember({ userId, roomId });
    }
    if (displayName) {
      member.displayName = displayName;
    }
    if (membership) {
      member.membership = membership;
    }
    if (membershipDateTime != null) {
      member.membershipDateTime = new Date(membershipDateTime);
    }
    if (membershipInitiator) {
      member.membershipInitiator = membershipInitiator;
    }

    this._memberCache.set(userId, member);
    return member;
  }

  public isDisplayingCode(toolRequest: ToolRequest) {
    return this._isDisplayingViewCodeMap.get(toolRequest.id) ?? false;
  }

  public toggleViewCode(toolRequest: ToolRequest) {
    this._isDisplayingViewCodeMap.set(
      toolRequest.id,
      !this.isDisplayingCode(toolRequest),
    );
  }
}

export function getRoom(
  parent: object,
  roomId: () => string | undefined,
  deps: () => unknown, //TODO: This line of code is needed to get the room to react to new messages. This should be removed in CS-6987
) {
  return RoomResource.from(parent, () => ({
    named: {
      roomId: roomId(),
      deps: deps(),
    },
  }));
}
