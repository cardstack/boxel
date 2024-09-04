import {
  contains,
  containsMany,
  field,
  Component,
  primitive,
  FieldDef,
} from './card-api';
import StringField from './string';
import DateTimeField from './datetime';
import {
  Loader,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { initSharedState } from './shared-state';
import { md5 } from 'super-fast-md5';
import { EventStatus } from 'matrix-js-sdk';
import { RoomMemberField } from './room-membership';
import { MessageField } from './message';
import { PatchField } from './command';
import {
  CardFragmentContent,
  CardMessageContent,
  MatrixEvent,
  ReactionEvent,
  RoomCreateEvent,
  RoomNameEvent,
} from './matrix-event';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

// this is so we can have triple equals equivalent room member cards
function upsertRoomMember({
  room,
  userId,
  displayName,
  membership,
  membershipTs,
  membershipInitiator,
}: {
  room: RoomField;
  userId: string;
  displayName?: string;
  membership?: 'invite' | 'join' | 'leave';
  membershipTs?: number;
  membershipInitiator?: string;
}): RoomMemberField {
  let roomMembers = roomMemberCache.get(room);
  if (!roomMembers) {
    roomMembers = new Map();
    roomMemberCache.set(room, roomMembers);
  }
  let member = roomMembers.get(userId);
  if (
    member?.membershipDateTime != null &&
    membershipTs != null &&
    member.membershipDateTime.getTime() > membershipTs
  ) {
    // the member data provided is actually older than what we have in our cache
    return member;
  }
  if (!member) {
    member = new RoomMemberField({
      id: userId,
      userId,
      roomId: room.roomId,
    });
    roomMembers.set(userId, member);
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

export class JSONView extends Component<typeof MatrixEventField> {
  <template>
    <pre>{{this.json}}</pre>
  </template>

  get json() {
    return JSON.stringify(this.args.model, null, 2);
  }
}

class MatrixEventField extends FieldDef {
  static [primitive]: MatrixEvent;
  static embedded = class Embedded extends JSONView {};
  static isolated = class Isolated extends JSONView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};
}

type MessageFieldArgs = {
  author: RoomMemberField;
  created: Date;
  updated: Date;
  message: string;
  formattedMessage: string;
  index: number;
  transactionId: string | null;
  attachedCard: string[] | null;
  command: string | null;
  isStreamingFinished?: boolean;
  clientGeneratedId?: string | null;
  status: EventStatus | null;
  eventId: string;
};

// A map from a hash of roomId + card document to the first card fragment event id.
// This map can be used to avoid sending the same version of the card more than once in a conversation.
// We can reuse exisiting eventId if user attached the same version of the card.
const cardHashes: Map<string, string> = new Map();
function generateCardHashKey(roomId: string, cardDoc: LooseSingleCardDocument) {
  return md5(roomId + JSON.stringify(cardDoc));
}

export function getEventIdForCard(
  roomId: string,
  cardDoc: LooseSingleCardDocument,
) {
  return cardHashes.get(generateCardHashKey(roomId, cardDoc));
}

interface RoomState {
  name?: string;
  creator?: RoomMemberField;
  created?: number;
}

// in addition to acting as a cache, this also ensures we have
// triple equal equivalence for the interior cards of RoomField
const eventCache = initSharedState(
  'eventCache',
  () => new WeakMap<RoomField, Map<string, MatrixEvent>>(),
);
const messageCache = initSharedState(
  'messageCache',
  () => new WeakMap<RoomField, Map<string, MessageField>>(),
);
const roomMemberCache = initSharedState(
  'roomMemberCache',
  () => new WeakMap<RoomField, Map<string, RoomMemberField>>(),
);
const roomStateCache = initSharedState(
  'roomStateCache',
  () => new WeakMap<RoomField, RoomState>(),
);
const fragmentCache = initSharedState(
  'fragmentCache',
  () => new WeakMap<RoomField, Map<string, CardFragmentContent>>(),
);

export class RoomField extends FieldDef {
  static displayName = 'Room';

  // the only writeable field for this card should be the "events" field.
  // All other fields should derive from the "events" field.
  @field events = containsMany(MatrixEventField);

  // This works well for synchronous computeds only
  @field newEvents = containsMany(MatrixEventField, {
    computeVia: function (this: RoomField) {
      let cache = eventCache.get(this);
      if (!cache) {
        cache = new Map();
        eventCache.set(this, cache);
      }
      let newEvents = new Map<string, MatrixEvent>();
      for (let event of this.events) {
        if (cache.has(event.event_id)) {
          continue;
        }
        cache.set(event.event_id, event);
        newEvents.set(event.event_id, event);
      }
      return [...newEvents.values()];
    },
  });

  @field roomId = contains(StringField, {
    computeVia: function (this: RoomField) {
      return this.events.length > 0 ? this.events[0].room_id : undefined;
    },
  });

  @field name = contains(StringField, {
    computeVia: function (this: RoomField) {
      let roomState = roomStateCache.get(this);
      if (!roomState) {
        roomState = {} as RoomState;
        roomStateCache.set(this, roomState);
      }

      // Read from this.events instead of this.newEvents to avoid a race condition bug where
      // newEvents never returns the m.room.name while the event is present in events
      let events = this.events
        .filter((e) => e.type === 'm.room.name')
        .sort(
          (a, b) => a.origin_server_ts - b.origin_server_ts,
        ) as RoomNameEvent[];
      if (events.length > 0) {
        roomState.name = events.pop()!.content.name;
      }

      return roomState.name;
    },
  });

  @field creator = contains(RoomMemberField, {
    computeVia: function (this: RoomField) {
      let roomState = roomStateCache.get(this);
      if (!roomState) {
        roomState = {} as RoomState;
        roomStateCache.set(this, roomState);
      }
      let creator = roomState.creator;
      if (creator) {
        return creator;
      }
      let event = this.newEvents.find((e) => e.type === 'm.room.create') as
        | RoomCreateEvent
        | undefined;
      if (event) {
        roomState.creator = upsertRoomMember({
          room: this,
          userId: event.sender,
        });
      }
      return roomState.creator;
    },
  });

  @field created = contains(DateTimeField, {
    computeVia: function (this: RoomField) {
      let roomState = roomStateCache.get(this);
      if (!roomState) {
        roomState = {} as RoomState;
        roomStateCache.set(this, roomState);
      }
      let created = roomState.created;
      if (created != null) {
        return new Date(created);
      }
      let event = this.newEvents.find((e) => e.type === 'm.room.create') as
        | RoomCreateEvent
        | undefined;
      if (event) {
        roomState.created = event.origin_server_ts;
      }
      return roomState.created != null
        ? new Date(roomState.created)
        : roomState.created;
    },
  });

  @field roomMembers = containsMany(RoomMemberField, {
    computeVia: function (this: RoomField) {
      let roomMembers = roomMemberCache.get(this);
      if (!roomMembers) {
        roomMembers = new Map();
        roomMemberCache.set(this, roomMembers);
      }

      for (let event of this.events) {
        if (event.type !== 'm.room.member') {
          continue;
        }
        let userId = event.state_key;
        upsertRoomMember({
          room: this,
          userId,
          displayName: event.content.displayname,
          membership: event.content.membership,
          membershipTs: event.origin_server_ts || Date.now(),
          membershipInitiator: event.sender,
        });
      }
      return [...roomMembers.values()];
    },
  });

  @field messages = containsMany(MessageField, {
    // since we are rendering this card without the isolated renderer, we cannot use
    // the rendering mechanism to test if a field is used or not, so we explicitely
    // tell the card runtime that this field is being used
    isUsed: true,
    computeVia: function (this: RoomField) {
      let loader = Loader.getLoaderFor(Object.getPrototypeOf(this).constructor);

      if (!loader) {
        throw new Error(
          'Could not find a loader for this instance’s class’s module',
        );
      }

      let cache = messageCache.get(this);
      if (!cache) {
        cache = new Map();
        messageCache.set(this, cache);
      }
      let index = cache.size;
      let newMessages = new Map<string, MessageField>();
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
        if (cache.has(event_id) && !update) {
          continue;
        }

        let author = upsertRoomMember({ room: this, userId: event.sender });
        let cardArgs: MessageFieldArgs = {
          author,
          created: new Date(event.origin_server_ts),
          updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
          message: event.content.body,
          formattedMessage: event.content.formatted_body,
          index,
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
        if (event.content.msgtype === 'org.boxel.cardFragment') {
          let fragments = fragmentCache.get(this);
          if (!fragments) {
            fragments = new Map();
            fragmentCache.set(this, fragments);
          }
          if (!fragments.has(event_id)) {
            fragments.set(event_id, event.content);
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

          cardArgs.clientGeneratedId = event.content.clientGeneratedId ?? null;
          messageField = new MessageField({
            ...cardArgs,
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

          messageField = new MessageField({
            ...cardArgs,
            formattedMessage: `<p class="patch-message">${event.content.formatted_body}</p>`,
            command: new PatchField({
              eventId: event_id,
              commandType: command.type,
              payload: command,
              status: annotation?.content['m.relates_to'].key ?? 'ready',
            }),
            isStreamingFinished: true,
          });
        } else {
          // Text from the AI bot
          if (event.content.msgtype === 'm.text') {
            cardArgs.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
          }
          messageField = new MessageField(cardArgs);
        }

        if (messageField) {
          // if the message is a replacement for other messages,
          // use `created` from the oldest one.
          if (newMessages.has(event_id)) {
            messageField.created = newMessages.get(event_id)!.created;
          }
          newMessages.set(
            (event.content as CardMessageContent).clientGeneratedId ?? event_id,
            messageField,
          );
          index++;
        }
      }

      // update the cache with the new messages
      for (let [id, message] of newMessages) {
        // The `id` can either be an `eventId` or `clientGeneratedId`.
        // For messages sent by the user, we prefer to use `clientGeneratedId`
        // because `eventId` can change in certain scenarios,
        // such as when resending a failed message or updating its status from sending to sent.
        cache.set(id, message);
      }

      // this sort should hopefully be very optimized since events will
      // be close to chronological order
      return [...cache.values()].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
      );
    },
  });

  @field joinedMembers = containsMany(RoomMemberField, {
    computeVia: function (this: RoomField) {
      return this.roomMembers.filter((m) => m.membership === 'join');
    },
  });

  @field invitedMembers = containsMany(RoomMemberField, {
    computeVia: function (this: RoomField) {
      return this.roomMembers.filter((m) => m.membership === 'invite');
    },
  });

  private serializedCardFromFragments(
    eventId: string,
  ): LooseSingleCardDocument {
    let cache = fragmentCache.get(this);
    if (!cache) {
      throw new Error(`No card fragment cache exists for this room`);
    }

    let fragments: CardFragmentContent[] = [];
    let currentFragment: string | undefined = eventId;
    do {
      let fragment = cache.get(currentFragment);
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
    cardHashes.set(generateCardHashKey(this.roomId, cardDoc), eventId);
    return cardDoc;
  }

  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div>Cannot edit room card</div>
    </template>
  };
}
