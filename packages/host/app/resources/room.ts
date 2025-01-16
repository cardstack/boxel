import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedMap } from 'tracked-built-ins';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  CardFragmentContent,
  CommandEvent,
  MatrixEvent as DiscreteMatrixEvent,
  RoomCreateEvent,
  RoomNameEvent,
  InviteEvent,
  JoinEvent,
  LeaveEvent,
  CardMessageEvent,
  MessageEvent,
  CommandResultEvent,
} from 'https://cardstack.com/base/matrix-event';

import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { Skill } from '../components/ai-assistant/skill-menu';
import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import { buildMessageCommand, formattedMessageForCommand } from '../lib/matrix-classes/message-builder';

import type Room from '../lib/matrix-classes/room';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import { CommandStatus } from 'https://cardstack.com/base/command';

interface SkillId {
  skillCardId: string;
  skillEventId: string;
  isActive: boolean;
}

interface Args {
  named: {
    roomId: string | undefined;
    events: DiscreteMatrixEvent[] | undefined;
  };
}

export class RoomResource extends Resource<Args> {
  private _previousRoomId: string | undefined;
  private _messageCreateTimesCache: Map<string, number> = new Map();
  private _messageCache: TrackedMap<string, Message> = new TrackedMap();
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
  @tracked loading: Promise<void> | undefined;

  // To avoid delay, instead of using `roomResource.activeLLM`, we use a tracked property
  // that updates immediately after the user selects the LLM.
  @tracked _activeLLM: string | undefined;
  @service private declare matrixService: MatrixService;
  @service private declare commandService: CommandService;
  @service private declare cardService: CardService;

  modify(_positional: never[], named: Args['named']) {
    if (named.roomId) {
      if (this.isNewRoom(named.roomId)) {
        this.resetCache();
      }
      this._previousRoomId = named.roomId;
      this.loading = this.load.perform(named.roomId);
      this._activeLLM = undefined;
    }
  }

  private isNewRoom(roomId: string) {
    return this._previousRoomId && roomId !== this._previousRoomId;
  }

  private resetCache() {
    this._messageCreateTimesCache = new Map();
    this._messageCache = new TrackedMap();
    this._memberCache = new TrackedMap();
    this._fragmentCache = new TrackedMap();
    this._nameEventsCache = new TrackedMap();
    this._skillCardsCache = new TrackedMap();
    this._isDisplayingViewCodeMap = new TrackedMap();
    this._createEvent = undefined;
  }

  private load = restartableTask(async (roomId: string) => {
    try {
      this.matrixRoom = roomId
        ? await this.matrixService.getRoomData(roomId)
        : undefined; //look at the note in the EventSendingContext interface for why this is awaited
      if (this.matrixRoom) {
        await this.loadFromEvents(roomId);
      }
    } catch (e) {
      throw new Error(`Error loading room ${e}`);
    }
  });

  get messages() {
    return [...this._messageCache.values()].sort(
      (a, b) => a.created.getTime() - b.created.getTime(),
    );
  }

  get members() {
    return Array.from(this._memberCache.values()) ?? [];
  }

  get invitedMembers() {
    return this.members.filter((m) => m.membership === 'invite');
  }

  get joinedMembers() {
    return this.members.filter((m) => m.membership === 'join');
  }

  private get events() {
    return this.matrixRoom?.events ?? [];
  }

  get skillIds(): SkillId[] {
    let skillsConfig = this.matrixRoom?.skillsConfig;
    if (!skillsConfig) {
      return [];
    }
    let result: SkillId[] = [];
    for (let eventId of [
      ...skillsConfig.enabledEventIds,
      ...skillsConfig.disabledEventIds,
    ]) {
      let cardDoc;
      try {
        cardDoc = this.serializedCardFromFragments(eventId);
      } catch {
        // the skill card fragments might not be loaded yet
        continue;
      }
      if (!cardDoc.data.id) {
        continue;
      }
      let cardId = cardDoc.data.id;
      if (!this._skillCardsCache.has(cardId)) {
        this.cardService
          .createFromSerialized(cardDoc.data, cardDoc)
          .then((skillsCard) => {
            this._skillCardsCache.set(cardId, skillsCard as SkillCard);
          });
      }
      result.push({
        skillCardId: cardDoc.data.id,
        skillEventId: eventId,
        isActive: skillsConfig.enabledEventIds.includes(eventId),
      });
    }
    return result;
  }

  get skills(): Skill[] {
    return this.skillIds
      .map(({ skillCardId, skillEventId, isActive }) => {
        let card = this._skillCardsCache.get(skillCardId);
        if (card) {
          return {
            card,
            skillEventId,
            isActive,
          };
        }
        return null;
      })
      .filter(Boolean) as Skill[];
  }

  get roomId() {
    return this._previousRoomId;
  }

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

  get lastActiveTimestamp() {
    let eventsWithTime = this.events.filter((t) => t.origin_server_ts);
    let maybeLastActive =
      eventsWithTime[eventsWithTime.length - 1].origin_server_ts;
    return maybeLastActive ?? this.created.getTime();
  }

  get activeLLM() {
    return this._activeLLM ?? this.matrixRoom?.activeLLM ?? DEFAULT_LLM;
  }

  activateLLM(model: string) {
    this._activeLLM = model;
    this.activateLLMTask.perform(model);
  }

  get isActivatingLLM() {
    return this.activateLLMTask.isRunning;
  }

  private activateLLMTask = restartableTask(async (model: string) => {
    if (!this.matrixRoom) {
      throw new Error('matrixRoom is required to activate LLM');
    }
    await this.matrixService.sendActiveLLMEvent(this.matrixRoom.roomId, model);
  });

  private async loadFromEvents(roomId: string) {
    let index = this._messageCache.size;

    //Sort events in ascending order by origin_server_ts to prevent 'cardFragment not found' errors.
    let sortedEvents = this.events.sort(
      (event1: DiscreteMatrixEvent, event2: DiscreteMatrixEvent) =>
        event1.origin_server_ts - event2.origin_server_ts,
    );

    for (let event of sortedEvents) {
      switch (event.type) {
        case 'm.room.member':
          await this.loadRoomMemberEvent(roomId, event);
          break;
        case APP_BOXEL_COMMAND_RESULT_EVENT_TYPE:
          await this.updateMessageCommand(event);
          break;
        case 'm.room.message':
          await this.loadRoomMessage({ roomId, event, index });
          break;
        case 'm.room.create':
          await this.loadRoomCreateEvent(event);
          break;
        case 'm.room.name':
          await this.loadRoomNameEvent(event);
          break;
      }
    }
  }

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

  private async updateMessageCommand(event: CommandResultEvent) {
    let effectiveEventId = this.getEffectiveEventId(event);
    let message = this._messageCache.get(effectiveEventId);
    if (!message) {
      return;
    }

    let commandEvent = this.events.find(
      (e: any) => e.type === 'm.room.message' && e.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE && e.content['m.relates_to'].event_id === effectiveEventId,
    )! as CommandEvent;
    if (!message.command) {
      message.command = buildMessageCommand({
        effectiveEventId,
        commandEvent,
        message,
        owner: getOwner(this)!,
      });
    }

    message.command.commandStatus = (event?.content['m.relates_to']?.key ||
      'ready') as CommandStatus;
    message.command.commandResultCardEventId = event?.content.msgtype ===
        APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
          ? event.content.data.cardEventId
          : undefined;
  }

  private async loadRoomMessage({
    roomId,
    event,
    index,
  }: {
    roomId: string;
    event: MessageEvent | CommandEvent | CardMessageEvent;
    index: number;
  }) {
    if (event.content.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE) {
      this._fragmentCache.set(event.event_id, event.content);
      return;
    }

    let effectiveEventId = this.getEffectiveEventId(event);
    let message = this._messageCache.get(effectiveEventId);
    if (!message) {
      message = await this.buildMessage({
        effectiveEventId,
        roomId,
        event,
        index,
      });
    }

    let earliestKnownCreateTime =
      this._messageCreateTimesCache.get(effectiveEventId);
    if (
      event.content['m.relates_to']?.rel_type === 'm.replace' &&
      (!earliestKnownCreateTime ||
        earliestKnownCreateTime <= event.origin_server_ts)
    ) {
      message.message = event.content.body;
      message.formattedMessage = event.content.formatted_body;
      message.isStreamingFinished =
        'isStreamingFinished' in event.content
          ? event.content.isStreamingFinished
          : undefined;
      if (event.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE) {
        if (!message.command) {
          message.command = buildMessageCommand({
            effectiveEventId,
            commandEvent: event as CommandEvent,
            message,
            owner: getOwner(this)!,
          });
        } else {
          message.formattedMessage = formattedMessageForCommand(event.content.formatted_body);

          let command = event.content.data.toolCall;
          message.command.name = command.name;
          message.command.payload = command.arguments;
        }
      }
      this._messageCreateTimesCache.set(
        effectiveEventId,
        event.origin_server_ts,
      );
    }
  }

  private async buildMessage({
    effectiveEventId,
    roomId,
    event,
    index,
  }: {
    effectiveEventId: string;
    roomId: string;
    event: MessageEvent | CommandEvent | CardMessageEvent;
    index: number;
  }) {
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
    });

    let messageObject = await messageBuilder.buildMessage();
    // if the message is a replacement for other messages,
    // use `created` from the oldest one.
    if (this._messageCache.has(effectiveEventId)) {
      messageObject.created = new Date(
        Math.min(
          ...[
            +this._messageCache.get(effectiveEventId)!.created!,
            +messageObject.created!,
            this._messageCreateTimesCache.get(effectiveEventId) ?? +Infinity,
          ],
        ),
      );
    }
    this._messageCreateTimesCache.set(effectiveEventId, event.origin_server_ts);
    this._messageCache.set(
      messageObject.clientGeneratedId ?? effectiveEventId,
      messageObject as any,
    );

    return messageObject;
  }

  private getEffectiveEventId(
    event: MessageEvent | CommandEvent | CardMessageEvent | CommandResultEvent,
  ) {
    return event.content['m.relates_to']?.rel_type === 'm.replace' || event.content['m.relates_to']?.rel_type === 'm.annotation'
      ? event.content['m.relates_to'].event_id
      : event.event_id;
  }

  private async loadRoomNameEvent(event: RoomNameEvent) {
    if (!this._nameEventsCache.has(event.event_id)) {
      this._nameEventsCache.set(event.event_id, event);
    }
  }

  private async loadRoomCreateEvent(event: RoomCreateEvent) {
    if (!this._createEvent) {
      this._createEvent = event;
    }
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

  public isDisplayingCode(message: Message) {
    return this._isDisplayingViewCodeMap.get(message.eventId) ?? false;
  }

  public toggleViewCode(message: Message) {
    this._isDisplayingViewCodeMap.set(
      message.eventId,
      !this.isDisplayingCode(message),
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
