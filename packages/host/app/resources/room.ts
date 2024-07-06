import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import type MatrixService from '../services/matrix-service';
import type {
  CardFragmentContent,
  MatrixEvent,
  RoomNameEvent,
} from 'https://cardstack.com/base/matrix-event';
import type { MessageField } from 'https://cardstack.com/base/message';

interface Args {
  named: {
    roomId: string | undefined;
    events: any[] | undefined;
  };
}

interface RoomMemberField {
  userId?: string;
  roomId?: string;
  displayName?: string;
  membershipDateTime?: Date;
  membershipInitiator?: Date;
  membership?: 'invite' | 'join' | 'leave';
}

export class RoomModel {
  @tracked events: MatrixEvent[] = [];

  get roomId() {
    return this.events.length > 0 ? this.events[0].room_id : undefined;
  }

  get createdDate() {
    return undefined;
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
}

// The resource is an mirror of the RoomModel
// RoomModel holds a lot of meta + events

// RoomResource is a cache for RoomModel messages
export class RoomResource extends Resource<Args> {
  _messageCache: Map<string, MessageField> = new Map();
  _memberCache: Map<string, RoomMemberField> = new Map();
  @tracked room: RoomModel | undefined;
  @tracked loading: Promise<void> | undefined;
  @service private declare matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    console.log(`running resource again with ${named.roomId}`);
    console.log(named.events);
    if (named.roomId) {
      this.loading = this.load.perform(named.roomId);
    }
  }

  private load = restartableTask(async (roomId: string | undefined) => {
    this.room = roomId ? await this.matrixService.getRoom(roomId) : undefined;
    if (this.room) {
      await this.loadRoomMembers(this.room);
      await this.loadRoomMessages(this.room);
    } else {
    }
  });

  get resourceMessages() {
    if (this._messageCache) {
      let o = [...this._messageCache.values()].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
      );
      console.log(`resource messages from ${this.room?.roomId}`);
      console.log(o);
      return o;
    }
    return [];
  }

  get messages() {
    return this.resourceMessages;
  }

  get resourceMembers() {
    return Array.from(this._memberCache.values()) ?? [];
  }

  get invitedMembers() {
    return this.resourceMembers.filter((m) => m.membership === 'invite');
  }

  get joinedMembers() {
    return this.resourceMembers.filter((m) => m.membership === 'join');
  }

  get events() {
    return this.room ? this.room.events : [];
  }

  async loadRoomMembers(room: RoomModel) {
    for (let event of this.events) {
      if (event.type !== 'm.room.member') {
        continue;
      }
      let userId = event.state_key;
      let roomMemberArgs = {
        userId,
        displayName: event.content.displayname,
        membership: event.content.membership,
        membershipTs: event.origin_server_ts || Date.now(),
        membershipInitiator: event.sender,
      };
      this.upsertRoomMember({
        room,
        ...roomMemberArgs,
      });
    }
  }

  async loadRoomMessages(room: RoomModel) {
    let newMessages = new Map<string, MessageField>();
    for (let event of this.events) {
      if (event.type !== 'm.room.message') {
        continue;
      }
      // =====
      let event_id = event.event_id;
      let update = false;
      if (event.content['m.relates_to']?.rel_type === 'm.replace') {
        event_id = event.content['m.relates_to'].event_id;
        update = true;
      }
      if (this._messageCache.has(event_id) && !update) {
        continue;
      }
      let author = this.upsertRoomMember({ room, userId: event.sender });
      let cardArgs = {
        author,
        created: new Date(event.origin_server_ts),
        updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
        message: event.content.body,
        formattedMessage: event.content.formatted_body,
        // These are not guaranteed to exist in the event
        transactionId: event.unsigned?.transaction_id || null,
        attachedCard: null,
        command: null,
        status: event.status,
        eventId: event.event_id,
      };
      if (event.status === 'cancelled' || event.status === 'not_sent') {
        (cardArgs as any).errorMessage =
          event.error?.data.errcode &&
          Object.keys(ErrorMessage).includes(event.error?.data.errcode)
            ? ErrorMessage[event.error?.data.errcode]
            : 'Failed to send';
      }
      if ('errorMessage' in event.content) {
        (cardArgs as any).errorMessage = event.content.errorMessage;
      }

      let messageField = undefined;
      if (event.content.msgtype === 'org.boxel.message') {
        // =======
        // Safely skip over cases that don't have attached cards or a data type
        // let cardDocs = event.content.data?.attachedCardsEventIds
        //   ? event.content.data.attachedCardsEventIds.map((eventId) =>
        //       this.serializedCardFromFragments(eventId),
        //     )
        //   : [];
        // let attachedCardIds: string[] = [];
        // cardDocs.map((c) => {
        //   if (c.data.id) {
        //     attachedCardIds.push(c.data.id);
        //   }
        // });
        // if (attachedCardIds.length < cardDocs.length) {
        //   throw new Error(`cannot handle cards in room without an ID`);
        // }
        // cardArgs.clientGeneratedId = event.content.clientGeneratedId ?? null;
        messageField = {
          ...cardArgs,
          // attachedCardIds,
        };
      } else {
        // Text from the AI bot
        if (event.content.msgtype === 'm.text') {
          cardArgs.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
        }
        messageField = { ...cardArgs };
      }

      if (messageField) {
        // if the message is a replacement for other messages,
        // use `created` from the oldest one.
        // =======
        if (newMessages.has(event_id)) {
          messageField.created = newMessages.get(event_id)!.created;
        }
        newMessages.set(
          (event.content as CardMessageContent).clientGeneratedId ?? event_id,
          messageField as any,
        );
      }
      for (let [id, message] of newMessages) {
        // The `id` can either be an `eventId` or `clientGeneratedId`.
        // For messages sent by the user, we prefer to use `clientGeneratedId`
        // because `eventId` can change in certain scenarios,
        // such as when resending a failed message or updating its status from sending to sent.
        this._messageCache.set(id, message);
      }
    }
  }

  upsertRoomMember({
    room,
    userId,
    displayName,
    membership,
    membershipTs,
    membershipInitiator,
  }: {
    room: RoomModel;
    userId: string;
    displayName?: string;
    membership?: 'invite' | 'join' | 'leave';
    membershipTs?: number;
    membershipInitiator?: string;
  }): RoomMemberField {
    let member = this._memberCache.get(userId);
    if (
      member?.membershipDateTime != null &&
      membershipTs != null &&
      member.membershipDateTime.getTime() > membershipTs
    ) {
      // the member data provided is actually older than what we have in our cache
      return member;
    }
    if (!member) {
      member = {
        // id: userId,
        userId,
        roomId: room.roomId,
      };
      this._memberCache.set(userId, member);
    }
    if (displayName) {
      member.displayName = displayName;
    }
    if (membership) {
      member.membership = membership;
    }
    if (membershipTs != null) {
      member.membershipDateTime = new Date(membershipTs);
    }
    if (membershipInitiator) {
      member.membershipInitiator = membershipInitiator;
    }
    return member;
  }
}

export function getRoom(
  parent: object,
  roomId: () => string | undefined,
  events: () => any | undefined, //we need this to react to new roomAddEvent
) {
  return RoomResource.from(parent, () => ({
    named: {
      roomId: roomId(),
      events: events ? events() : [],
    },
  }));
}

//utils

// function createMessageField(event: MatrixEvent): MessageField {
//   return {
//     // author
//     author: {
//       userId: event.sender, //userId of the author
//     },
//     created: new Date(event.origin_server_ts),
//     updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
//     message: event.content.body,
//     formattedMessage: event.content.formatted_body,
//     // index,
//     // These are not guaranteed to exist in the event
//     transactionId: event.unsigned?.transaction_id || null,
//     attachedCard: null,
//     command: null,
//     status: event.status,
//     eventId: event.event_id,
//   };
// }
