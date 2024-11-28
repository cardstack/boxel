import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedMap, TrackedObject } from 'tracked-built-ins';

import type {
  CardFragmentContent,
  CommandEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  RoomCreateEvent,
  RoomNameEvent,
  InviteEvent,
  JoinEvent,
  LeaveEvent,
  CardMessageEvent,
  MessageEvent,
} from 'https://cardstack.com/base/matrix-event';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import MessageBuilder from '../lib/matrix-classes/message-builder';

import type { Skill } from '../components/ai-assistant/skill-menu';
import type RoomState from '../lib/matrix-classes/room-state';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';

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
  private _nameEventsCache: TrackedMap<string, RoomNameEvent> =
    new TrackedMap();
  @tracked private _createEvent: RoomCreateEvent | undefined;
  private _memberCache: TrackedMap<string, RoomMember> = new TrackedMap();
  private _fragmentCache: TrackedMap<string, CardFragmentContent> =
    new TrackedMap();
  @tracked roomState: RoomState | undefined;
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
    this._createEvent = undefined;
  }

  private load = restartableTask(async (roomId: string) => {
    try {
      this.roomState = roomId
        ? await this.matrixService.getRoomState(roomId)
        : undefined; //look at the note in the EventSendingContext interface for why this is awaited
      if (this.roomState) {
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
    return this.roomState?.events ?? [];
  }

  get skills(): Skill[] {
    return this.roomState?.skills ?? [];
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
    let events = Array.from(this._nameEventsCache.values()).sort(
      (a, b) => a.origin_server_ts - b.origin_server_ts,
    ) as RoomNameEvent[];
    if (events.length > 0) {
      return events.pop()!.content.name;
    }
    return;
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
    event: MessageEvent | CommandEvent | CardMessageEvent | CommandResultEvent,
    index: number,
  ) {
    let effectiveEventId = event.event_id;
    let update = false;
    if (event.content['m.relates_to']?.rel_type == 'm.annotation') {
      // we have to trigger a message field update if there is a reaction event so apply button state reliably updates
      // otherwise, the message field (may) still but it occurs only accidentally because of a ..thinking event
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
    if (event.content.msgtype === 'org.boxel.cardFragment') {
      if (!this._fragmentCache.has(effectiveEventId)) {
        this._fragmentCache.set(effectiveEventId, event.content);
      }
      return;
    }
    if (event.content.msgtype === 'org.boxel.commandResult') {
      //don't display command result in the room as a message
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
      fragmentCache: this._fragmentCache,
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
      let member = new RoomMember({ userId, roomId });
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
    return member;
  }

  addSkill(card: SkillCard) {
    if (!this.roomState) {
      return;
    }
    this.roomState.skills = [
      ...this.roomState.skills,
      new TrackedObject({ card, isActive: true }),
    ];
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
