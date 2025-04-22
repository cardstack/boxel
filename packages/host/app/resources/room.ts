import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import { TaskInstance, restartableTask, timeout } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedMap } from 'tracked-built-ins';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  CardFragmentContent,
  MatrixEvent as DiscreteMatrixEvent,
  RoomCreateEvent,
  RoomNameEvent,
  InviteEvent,
  JoinEvent,
  LeaveEvent,
  CardMessageEvent,
  MessageEvent,
  CommandDefinitionsEvent,
  CommandResultEvent,
  RealmServerEvent,
} from 'https://cardstack.com/base/matrix-event';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import type Room from '../lib/matrix-classes/room';

import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export type RoomSkill = {
  cardId: string;
  skillEventId: string;
  isActive: boolean;
};

interface Args {
  named: {
    roomId: string | undefined;
    events: DiscreteMatrixEvent[] | undefined;
  };
}

export class RoomResource extends Resource<Args> {
  private _messageCache: TrackedMap<string, Message> = new TrackedMap();
  private _skillEventIdToCardIdCache: TrackedMap<string, string> =
    new TrackedMap();
  private _skillCardsCache: TrackedMap<string, SkillCard> = new TrackedMap();
  private _nameEventsCache: TrackedMap<string, RoomNameEvent> =
    new TrackedMap();
  @tracked private _createEvent: RoomCreateEvent | undefined;
  private _memberCache: TrackedMap<string, RoomMember> = new TrackedMap();
  private _fragmentCache: TrackedMap<string, CardFragmentContent> =
    new TrackedMap();
  private _isDisplayingViewCodeMap: TrackedMap<string, boolean> =
    new TrackedMap();
  @tracked matrixRoom: Room | undefined;
  @tracked processing: TaskInstance<void> | undefined;
  @tracked roomId: string | undefined;

  // To avoid delay, instead of using `roomResource.activeLLM`, we use a tracked property
  // that updates immediately after the user selects the LLM.
  @tracked private llmBeingActivated: string | undefined;
  @service declare private matrixService: MatrixService;
  @service declare private commandService: CommandService;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    if (!named.roomId) {
      return;
    }
    this.roomId = named.roomId;
    this.processing = this.processRoomTask.perform(named.roomId);
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

      let index = this._messageCache.size;
      // This is brought up to this level so if the
      // load task is rerun we can stop processing
      for (let event of this.sortedEvents) {
        switch (event.type) {
          case 'm.room.member':
            await this.loadRoomMemberEvent(roomId, event);
            break;
          case 'm.room.message':
            if (this.isCardFragmentEvent(event)) {
              await this.loadCardFragment(event);
            } else if (
              this.isCommandDefinitionsEvent(event) ||
              this.isRealmServerEvent(event)
            ) {
              break;
            } else {
              await this.loadRoomMessage({
                roomId,
                event,
                index,
              });
            }
            break;
          case APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
            this.updateMessageCommandResult({ roomId, event, index });
            break;
          case 'm.room.create':
            await this.loadRoomCreateEvent(event);
            break;
          case 'm.room.name':
            await this.loadRoomNameEvent(event);
            break;
        }
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

  private get events() {
    return this.matrixRoom?.events ?? [];
  }

  @cached
  private get sortedEvents() {
    return this.events.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  }

  private get allSkillEventIds(): Set<string> {
    let skillsConfig = this.matrixRoom?.skillsConfig;
    if (!skillsConfig) {
      return new Set();
    }
    return new Set([
      ...skillsConfig.enabledEventIds,
      ...skillsConfig.disabledEventIds,
    ]);
  }

  get skills(): RoomSkill[] {
    let result: RoomSkill[] = [];
    for (let skillEventId of this.allSkillEventIds) {
      let cardId = this._skillEventIdToCardIdCache.get(skillEventId);
      if (!cardId) {
        continue;
      }
      result.push({
        cardId,
        skillEventId,
        isActive:
          this.matrixRoom?.skillsConfig.enabledEventIds.includes(
            skillEventId,
          ) ?? false,
      });
    }
    return result;
  }

  get commands() {
    // Usable commands are all commands on *active* skills
    let commands = [];
    for (let skill of this.skills) {
      let skillCard = this._skillCardsCache.get(skill.cardId);
      if (skillCard && skill.isActive) {
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
      eventsWithTime[eventsWithTime.length - 1].origin_server_ts;
    return maybeLastActive ?? this.created.getTime();
  }

  get activeLLM(): string {
    return this.llmBeingActivated ?? this.matrixRoom?.activeLLM ?? DEFAULT_LLM;
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

  private isCommandDefinitionsEvent(
    event:
      | MessageEvent
      | CardMessageEvent
      | CommandDefinitionsEvent
      | RealmServerEvent,
  ): event is CommandDefinitionsEvent {
    return event.content.msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE;
  }

  private isRealmServerEvent(
    event:
      | MessageEvent
      | CardMessageEvent
      | CommandDefinitionsEvent
      | RealmServerEvent,
  ): event is RealmServerEvent {
    return event.content.msgtype === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE;
  }

  private isCardFragmentEvent(
    event:
      | MessageEvent
      | CardMessageEvent
      | CommandDefinitionsEvent
      | RealmServerEvent,
  ): event is CardMessageEvent & {
    content: { msgtype: typeof APP_BOXEL_CARDFRAGMENT_MSGTYPE };
  } {
    return event.content.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE;
  }

  private async loadCardFragment(
    event: CardMessageEvent & {
      content: { msgtype: typeof APP_BOXEL_CARDFRAGMENT_MSGTYPE };
    },
  ) {
    let eventId = event.event_id;
    this._fragmentCache.set(eventId, event.content);

    if (this.isSkillEventId(eventId)) {
      await this.ensureSkillCardCached(eventId);
    }
  }

  private isSkillEventId(eventId: string) {
    return this.allSkillEventIds.has(eventId);
  }

  // TODO we should think about why we are caching these running instances
  // outside of the store. it would be a good idea to bring these into the fold
  // so that we can make the `createFromSerialized()` more private.
  private async ensureSkillCardCached(eventId: string) {
    if (this._skillEventIdToCardIdCache.has(eventId)) {
      return;
    }
    let cardDoc = this.serializedCardFromFragments(eventId);
    if (!cardDoc.data.id) {
      console.warn(
        `No card id found for skill event id ${eventId}, this should not happen, this can happen if you add a skill card to a room without saving it, and without giving it an ID`,
      );
      return;
    }
    let cardId = cardDoc.data.id;
    // Warning these are garbage collected: probably that's ok since nothing
    // links to this, but we should refactor this to the store for its cache
    // instead: CS-8304
    let skillCard = await this.store.add<SkillCard>(cardDoc, {
      doNotPersist: true,
    });
    this._skillCardsCache.set(cardId, skillCard);
    this._skillEventIdToCardIdCache.set(eventId, cardId);
  }

  private loadRoomMessage({
    roomId,
    event,
    index,
  }: {
    roomId: string;
    event: MessageEvent | CardMessageEvent;
    index: number;
  }) {
    let effectiveEventId = this.getEffectiveEventId(event);

    let message = this._messageCache.get(effectiveEventId);
    let author = this.upsertRoomMember({
      roomId,
      userId: event.sender,
    });
    let messageBuilder = new MessageBuilder(event, getOwner(this)!, {
      roomId,
      effectiveEventId,
      author,
      index,
      serializedCardFromFragments: this.serializedCardFromFragments,
      events: this.events,
      skills: this.skills,
      skillCardsCache: this._skillCardsCache,
    });

    if (!message) {
      message = messageBuilder.buildMessage();
      this._messageCache.set(
        message.clientGeneratedId ?? effectiveEventId,
        message as any,
      );
    }

    messageBuilder.updateMessage(message);
  }

  private updateMessageCommandResult({
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
        serializedCardFromFragments: this.serializedCardFromFragments,
        events: this.events,
        skills: this.skills,
        commandResultEvent: event,
        skillCardsCache: this._skillCardsCache,
      },
    );
    messageBuilder.updateMessageCommandResult(message);
  }

  private getEffectiveEventId(
    event: MessageEvent | CardMessageEvent | CommandResultEvent,
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

  public serializedCardFromFragments = (eventId: string) => {
    let fragments: CardFragmentContent[] = [];
    let currentFragment: string | undefined = eventId;
    do {
      let fragment = this._fragmentCache.get(currentFragment);
      if (!fragment) {
        throw new Error(
          `No card fragment found in cache for event id ${eventId}`,
        );
      }
      fragments.push(fragment);
      currentFragment = fragment.data.nextFragment;
    } while (currentFragment);

    fragments.sort((a, b) => (a.data.index = b.data.index));
    if (fragments.length !== fragments[0].data.totalParts) {
      throw new Error(
        `Expected to find ${fragments[0].data.totalParts} fragments for fragment of event id ${eventId} but found ${fragments.length} fragments`,
      );
    }

    let cardDoc = JSON.parse(
      fragments.map((f) => f.data.cardFragment).join(''),
    ) as LooseSingleCardDocument;
    return cardDoc;
  };

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
