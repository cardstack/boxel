import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import { TaskInstance, restartableTask, timeout } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import difference from 'lodash/difference';

import { IRoomEvent } from 'matrix-js-sdk';
import { TrackedMap } from 'tracked-built-ins';

import {
  isCardInstance,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_LLM_MODE,
  DEFAULT_LLM,
  type LLMMode,
} from '@cardstack/runtime-common/matrix-constants';

import type { SerializedFile } from 'https://cardstack.com/base/file-api';
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
  CommandResultEvent,
  RealmServerEvent,
  CodePatchResultEvent,
  ActiveLLMEvent,
} from 'https://cardstack.com/base/matrix-event';

import type { Skill } from 'https://cardstack.com/base/skill';

import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import type Room from '../lib/matrix-classes/room';

import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export type RoomSkill = {
  cardId: string;
  realmURL: string | undefined;
  fileDef: SerializedFile;
  isActive: boolean;
};

interface Args {
  named: {
    roomId: string | undefined;
    events: DiscreteMatrixEvent[] | undefined;
  };
}

export class RoomResource extends Resource<Args> {
  #skillIds = new Set<string>();
  #hasRegisteredDestructor = false;
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
  @service declare private commandService: CommandService;
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
      registerDestructor(this, () => {
        for (let id of this.#skillIds ?? []) {
          this.store.dropReference(id);
        }
      });
    }
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
          case APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
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
        realmURL: this.realm.realmOfURL(new URL(skillCard.sourceUrl))?.href,
        fileDef: skillCard,
        isActive:
          this.matrixRoom?.skillsConfig.enabledSkillCards
            .map((enabledCard) => enabledCard.sourceUrl)
            .includes(skillCard.sourceUrl) ?? false,
      });
    }
    return result;
  }

  get commands() {
    // Usable commands are all commands on *active* skills
    let commands = [];
    for (let skill of this.skills) {
      let skillCard = this.store.peek<Skill>(skill.cardId);
      if (skillCard && isCardInstance(skillCard) && skill.isActive) {
        commands.push(...skillCard.commands);
      }
    }
    return commands;
  }

  @cached
  get created() {
    if (this._createEvent) {
      return new Date(this._createEvent.origin_server_ts);
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
      this.llmBeingActivated ?? this.matrixRoom?.activeLLM ?? this.defaultLLM
    );
  }

  private get defaultLLM(): string {
    let systemCard = this.matrixService.systemCard;
    return (
      systemCard?.defaultModelConfiguration?.modelId ??
      systemCard?.modelConfigurations?.[0]?.modelId ??
      DEFAULT_LLM
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

  activateLLMTask = restartableTask(async (model: string) => {
    await this.processing;
    if (this.activeLLM === model) {
      return;
    }
    this.llmBeingActivated = model;
    try {
      if (!this.matrixRoom) {
        throw new Error('matrixRoom is required to activate LLM');
      }
      await this.matrixService.sendActiveLLMEvent(
        this.matrixRoom.roomId,
        model,
      );
      let remainingRetries = 20;
      while (this.matrixRoom.activeLLM !== model && remainingRetries > 0) {
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
   * Get the active LLM mode at a specific timestamp by looking at the most recent
   * LLM mode event that occurred before or at the given timestamp.
   */
  getActiveLLMModeAtTimestamp(timestamp: number): LLMMode {
    let latestLLMModeEvent: DiscreteMatrixEvent | undefined;

    for (let event of this.llmModeEvents) {
      if (event.origin_server_ts <= timestamp) {
        if (
          !latestLLMModeEvent ||
          event.origin_server_ts > latestLLMModeEvent.origin_server_ts
        ) {
          latestLLMModeEvent = event;
        }
      }
    }

    // If no LLM mode event found before the timestamp, default to 'ask'
    if (!latestLLMModeEvent) {
      return 'ask';
    }

    return (latestLLMModeEvent as any).content?.mode ?? 'ask';
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
      let cardDoc =
        await this.matrixService.downloadCardFileDef(skillCardFileDef);
      let skill = await this.loadSkill(cardDoc);
      if (skill?.id) {
        skillIds.push(skill.id);
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
      this.store.addReference(id);
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

    let message = this._messageCache.get(effectiveEventId);
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

  private async updateMessageCommandResult({
    roomId,
    event,
    index,
  }: {
    roomId: string;
    event: CommandResultEvent;
    index: number;
  }) {
    let effectiveEventId = this.getEffectiveEventId(event);
    let messageEventWithCommand = this.events.find(
      (e: any) =>
        e.type === 'm.room.message' &&
        e.content[APP_BOXEL_COMMAND_REQUESTS_KEY]?.length &&
        (e.event_id === effectiveEventId ||
          e.content['m.relates_to']?.event_id === effectiveEventId),
    )! as CardMessageEvent | undefined;
    let message = this._messageCache.get(effectiveEventId);
    if (!message || !messageEventWithCommand) {
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
        effectiveEventId,
        author,
        index,
        events: this.events,
        skills: this.skills,
        commandResultEvent: event,
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
      | CommandResultEvent
      | CodePatchResultEvent
      | DebugMessageEvent,
  ) {
    if (!('m.relates_to' in event.content)) {
      return event.event_id;
    }

    return event.content['m.relates_to']?.rel_type === 'm.replace' ||
      event.content['m.relates_to']?.rel_type ===
        APP_BOXEL_COMMAND_RESULT_REL_TYPE
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

  public isDisplayingCode(commandRequest: CommandRequest) {
    return this._isDisplayingViewCodeMap.get(commandRequest.id) ?? false;
  }

  public toggleViewCode(commandRequest: CommandRequest) {
    this._isDisplayingViewCodeMap.set(
      commandRequest.id,
      !this.isDisplayingCode(commandRequest),
    );
  }
}

export function getRoom(
  parent: object,
  roomId: () => string | undefined,
  events: () => any | undefined, //TODO: This line of code is needed to get the room to react to new messages. This should be removed in CS-6987
) {
  return RoomResource.from(parent, () => ({
    named: {
      roomId: roomId(),
      events: events ? events() : [],
    },
  }));
}
