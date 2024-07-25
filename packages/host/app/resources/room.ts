import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { TrackedMap, TrackedObject } from 'tracked-built-ins';

import { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { CommandStatus } from 'https://cardstack.com/base/command';
import type {
  CardFragmentContent,
  CardMessageContent,
  ReactionEvent,
} from 'https://cardstack.com/base/matrix-event';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

import type {
  RoomCreateEvent,
  RoomNameEvent,
} from 'https://cardstack.com/base/matrix-event';

import {
  RoomMember,
  type RoomMemberInterface,
} from '../lib/matrix-classes/member';
import { Message } from '../lib/matrix-classes/message';

import { RoomState } from '../lib/matrix-classes/room';

import { CardResource } from './card-resource';

import type { Skill } from '../components/ai-assistant/skill-menu';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';

interface Args {
  named: {
    roomId: string | undefined;
    events: DiscreteMatrixEvent[] | undefined;
  };
}

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

export class RoomResource extends Resource<Args> {
  private _messageCache: TrackedMap<string, Message> = new TrackedMap();
  private _memberCache: TrackedMap<string, RoomMember> = new TrackedMap();
  private _fragmentCache: TrackedMap<string, CardFragmentContent> =
    new TrackedMap();
  @tracked room: RoomState | undefined;
  @tracked loading: Promise<void> | undefined;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  _roomId: string | undefined;

  modify(_positional: never[], named: Args['named']) {
    if (named.roomId) {
      if (this.isNewRoom(named.roomId)) {
        this.resetCache();
      }
      this._roomId = named.roomId;
      this.loading = this.load.perform(named.roomId);
    }
  }

  private isNewRoom(roomId: string) {
    return this._roomId && roomId !== this._roomId;
  }

  private resetCache() {
    this._messageCache = new TrackedMap();
    this._memberCache = new TrackedMap();
    this._fragmentCache = new TrackedMap();
  }

  private load = restartableTask(async (roomId: string) => {
    try {
      this.room = roomId ? await this.matrixService.getRoom(roomId) : undefined; //look at the note in the EventSendingContext interface for why this is awaited
      if (this.room) {
        await this.loadRoomMembers(roomId);
        await this.loadRoomMessages(roomId);
      }
    } catch (e) {
      throw new Error(`Error loading room ${e}`);
    }
  });

  get messages() {
    if (this._messageCache) {
      return [...this._messageCache.values()].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
      );
    }
    return [];
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
    return this.room ? this.room.events : [];
  }

  get skills(): Skill[] {
    return this.room?.skills ?? [];
  }

  get roomId() {
    return this._roomId;
  }

  get created() {
    let event = this.events.find((e) => e.type === 'm.room.create') as
      | RoomCreateEvent
      | undefined;
    if (event) {
      return new Date(event.origin_server_ts);
    }
    // there is a race condition in the matrix SDK where newly created
    // rooms don't immediately have a created date
    return new Date();
  }

  get name() {
    // Read from this.events instead of this.newEvents to avoid a race condition bug where
    // newEvents never returns the m.room.name while the event is present in events
    let events = this.events
      .filter((e) => e.type === 'm.room.name')
      .sort(
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

  private async loadRoomMembers(roomId: string) {
    for (let event of this.events) {
      if (event.type !== 'm.room.member') {
        continue;
      }
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
  }

  private async loadRoomMessages(roomId: string) {
    let index = this._messageCache.size;
    let newMessages = new Map<string, Message>();
    for (let event of this.events) {
      if (event.type !== 'm.room.message') {
        continue;
      }
      let event_id = event.event_id;
      let update = false;
      if (event.content['m.relates_to']?.rel_type === 'm.replace') {
        event_id = event.content['m.relates_to'].event_id;
        update = true;
      }
      if (this._messageCache.has(event_id) && !update) {
        continue;
      }
      let author = this.upsertRoomMember({
        roomId,
        userId: event.sender,
      });
      let messageArgs = new Message({
        author,
        created: new Date(event.origin_server_ts),
        updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
        message: event.content.body,
        formattedMessage: event.content.formatted_body,
        // These are not guaranteed to exist in the event
        transactionId: event.unsigned?.transaction_id || null,
        attachedCardIds: null,
        attachedSkillCardIds: null,
        command: null,
        status: event.status,
        eventId: event.event_id,
        index,
      });
      if (event.status === 'cancelled' || event.status === 'not_sent') {
        (messageArgs as any).errorMessage =
          event.error?.data.errcode &&
          Object.keys(ErrorMessage).includes(event.error?.data.errcode)
            ? ErrorMessage[event.error?.data.errcode]
            : 'Failed to send';
      }
      if ('errorMessage' in event.content) {
        (messageArgs as any).errorMessage = event.content.errorMessage;
      }
      let messageField = undefined;

      if (event.content.msgtype === 'org.boxel.cardFragment') {
        if (!this._fragmentCache.has(event_id)) {
          this._fragmentCache.set(event_id, event.content);
        }
      } else if (event.content.msgtype === 'org.boxel.message') {
        // Safely skip over cases that don't have attached cards or a data type
        let cardDocs = event.content.data?.attachedCardsEventIds
          ? event.content.data.attachedCardsEventIds.map((eventId) =>
              this.serializedCardFromFragments(eventId),
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
        messageArgs.clientGeneratedId = event.content.clientGeneratedId;
        messageField = new Message({
          ...messageArgs,
          attachedCardIds,
        });
      } else if (event.content.msgtype === 'org.boxel.command') {
        // We only handle patches for now
        let command = event.content.data.command;
        let annotation = this.events.find(
          (e) =>
            e.type === 'm.reaction' &&
            e.content['m.relates_to']?.rel_type === 'm.annotation' &&
            e.content['m.relates_to']?.event_id ===
              // If the message is a replacement message, eventId in command payload will be undefined.
              // Because it will not refer to any other events, so we can use event_id of the message itself.
              (command.eventId ?? event_id),
        ) as ReactionEvent | undefined;
        let status: CommandStatus =
          annotation?.content['m.relates_to'].key === 'applied'
            ? annotation?.content['m.relates_to'].key
            : 'ready';

        let commandField = await this.matrixService.createCommandField({
          eventId: event_id,
          commandType: command.type,
          payload: command,
          status: status,
        });

        messageField = new Message({
          ...messageArgs,
          formattedMessage: `<p class="patch-message">${event.content.formatted_body}</p>`,
          command: commandField,
          isStreamingFinished: true,
        });
      } else {
        // Text from the AI bot
        if (event.content.msgtype === 'm.text') {
          messageArgs.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
        }
        messageField = new Message({ ...messageArgs });
      }

      if (messageField) {
        // if the message is a replacement for other messages,
        // use `created` from the oldest one.
        if (this._messageCache.has(event_id)) {
          let d1 = this._messageCache.get(event_id)!.created!;
          let d2 = messageField.created!;
          messageField.created = d1 < d2 ? d1 : d2;
        }
        newMessages.set(
          (event.content as CardMessageContent).clientGeneratedId ?? event_id,
          messageField as any,
        );
      }
    }

    for (let [id, message] of newMessages) {
      // The `id` can either be an `eventId` or `clientGeneratedId`.
      // For messages sent by the user, we prefer to use `clientGeneratedId`
      // because `eventId` can change in certain scenarios,
      // such as when resending a failed message or updating its status from sending to sent.
      this._messageCache.set(id, message);
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

  private serializedCardFromFragments(
    eventId: string,
  ): LooseSingleCardDocument {
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
  }

  addSkill(cardResource: CardResource) {
    if (!this.room) {
      return;
    }
    this.room.skills = [
      ...this.room.skills,
      new TrackedObject({
        cardResource,
        isActive: true,
      }),
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
