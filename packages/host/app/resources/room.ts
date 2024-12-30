import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedMap } from 'tracked-built-ins';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import { APP_BOXEL_CARDFRAGMENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

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
} from 'https://cardstack.com/base/matrix-event';

import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { Skill } from '../components/ai-assistant/skill-menu';
import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import type Room from '../lib/matrix-classes/room';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';

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
  @tracked matrixRoom: Room | undefined;
  @tracked loading: Promise<void> | undefined;
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

  private async loadFromEvents(roomId: string) {
    let index = this._messageCache.size;
    for (let event of this.events) {
      switch (event.type) {
        case 'm.room.member':
          await this.loadRoomMemberEvent(roomId, event);
          break;
        case 'm.room.message':
          await this.loadRoomMessage(roomId, event, index);
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

  private async loadRoomMessage(
    roomId: string,
    event: MessageEvent | CommandEvent | CardMessageEvent,
    index: number,
  ) {
    let effectiveEventId = event.event_id;
    let update = false;
    if (event.content['m.relates_to']?.rel_type == 'm.annotation') {
      // ensure that we update a message when we see a reaction event for it, since we merge data from the reaction event
      // into the message state (i.e. apply button, command result)
      update = true;
    } else if (event.content['m.relates_to']?.rel_type === 'm.replace') {
      effectiveEventId = event.content['m.relates_to'].event_id;
      if (
        'isStreamingFinished' in event.content &&
        !event.content.isStreamingFinished
      ) {
        // we don't need to process this event if it's not finished streaming,
        // but we do need to note it's creation time so that we can capture the earliest one
        let earliestKnownCreateTime =
          this._messageCreateTimesCache.get(effectiveEventId);
        if (
          !earliestKnownCreateTime ||
          earliestKnownCreateTime > event.origin_server_ts
        ) {
          this._messageCreateTimesCache.set(
            effectiveEventId,
            event.origin_server_ts,
          );
          let alreadyProcessedMessage =
            this._messageCache.get(effectiveEventId);
          if (alreadyProcessedMessage) {
            alreadyProcessedMessage.created = new Date(event.origin_server_ts);
          }
        }
        return;
      }
      update = true;
    }
    if (this._messageCache.has(effectiveEventId) && !update) {
      return;
    }
    if (event.content.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE) {
      if (!this._fragmentCache.has(effectiveEventId)) {
        this._fragmentCache.set(effectiveEventId, event.content);
      }
      return;
    }
    let author = this.upsertRoomMember({
      roomId,
      userId: event.sender,
    });
    let messageBuilder = new MessageBuilder(event, getOwner(this)!, {
      effectiveEventId,
      author,
      index,
      serializedCardFromFragments: this.serializedCardFromFragments,
      events: this.events,
    });

    let messageObject = await messageBuilder.buildMessage();
    if (messageObject) {
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
      this._messageCache.set(
        messageObject.clientGeneratedId ?? effectiveEventId,
        messageObject as any,
      );
    }
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

  private serializedCardFromFragments = (eventId: string) => {
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
