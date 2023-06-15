import {
  contains,
  containsMany,
  field,
  Component,
  Card,
  primitive,
  useIndexBasedKey,
  CardBase,
  createFromSerialized,
} from './card-api';
import StringCard from './string';
import DateTimeCard from './datetime';
import IntegerCard from './integer';
import MarkdownCard from './markdown';
import { BoxelMessage } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { formatRFC3339 } from 'date-fns';
import Modifier from 'ember-modifier';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

// this is so we can have triple equals equivalent room member cards
function upsertRoomMember(
  matrixRoomCard: MatrixRoomCard,
  userId: string,
  displayName?: string,
  membership?: 'invite' | 'join' | 'leave'
): RoomMemberCard {
  let roomMembers = roomMemberCache.get(matrixRoomCard);
  if (!roomMembers) {
    roomMembers = new Map();
    roomMemberCache.set(matrixRoomCard, roomMembers);
  }
  let member = roomMembers.get(userId);
  if (!member) {
    member = new RoomMemberCard({ id: userId, userId });
    roomMembers.set(userId, member);
  }
  // patch in the display name in case we don't have one yet
  // TODO need to look up the event used to change the display name
  if (displayName) {
    member.displayName = displayName;
  }
  if (membership) {
    member.membership = membership;
  }
  return member;
}

// this is so we can have triple equals equivalent attached cards in messages
const attachedCards = new Map<string, Promise<Card>>();

class JSONView extends Component<typeof MatrixEventCard> {
  <template>
    <pre>{{this.json}}</pre>
  </template>

  get json() {
    return JSON.stringify(this.args.model, null, 2);
  }
}

class MatrixEventCard extends CardBase {
  static [primitive]: MatrixEvent;
  static embedded = class Embedded extends JSONView {};
  static isolated = class Isolated extends JSONView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};
}

const messageStyle = {
  boxelMessageAvatarSize: '2.5rem',
  boxelMessageMetaHeight: '1.25rem',
  boxelMessageGap: 'var(--boxel-sp)',
  boxelMessageMarginLeft:
    'calc( var(--boxel-message-avatar-size) + var(--boxel-message-gap) )',
};

class RoomMemberView extends Component<typeof RoomMemberCard> {
  <template>
    <div>
      User ID:
      {{@model.userId}}
    </div>
    <div>
      Name:
      {{@model.displayName}}
    </div>
    <div>
      Membership:
      {{@model.membership}}
    </div>
  </template>
}

class RoomMembershipCard extends CardBase {
  static [primitive]: 'invite' | 'join' | 'leave';
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  // The edit template is meant to be read-only, this field card is not mutable, room state can only be changed via matrix API
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

class RoomMemberCard extends Card {
  @field userId = contains(StringCard);
  @field displayName = contains(StringCard);
  @field membership = contains(RoomMembershipCard);
  static embedded = class Embedded extends RoomMemberView {};
  static isolated = class Isolated extends RoomMemberView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends RoomMemberView {};
}

class ScrollIntoView extends Modifier {
  modify(element: HTMLElement) {
    element.scrollIntoView();
  }
}

class MessageCard extends Card {
  @field author = contains(RoomMemberCard);
  @field message = contains(MarkdownCard);
  @field formattedMessage = contains(StringCard);
  @field created = contains(DateTimeCard);
  @field attachedCard = contains(Card);
  @field index = contains(IntegerCard);

  static embedded = class Embedded extends Component<typeof this> {
    // TODO need to add the message specific CSS here
    <template>
      <BoxelMessage
        {{ScrollIntoView}}
        data-test-message-idx={{@model.index}}
        data-test-message-card={{@model.attachedCard.id}}
        @name={{@model.author.displayName}}
        @datetime={{formatRFC3339 this.timestamp}}
        style={{cssVar
          boxel-message-avatar-size=messageStyle.boxelMessageAvatarSize
          boxel-message-meta-height=messageStyle.boxelMessageMetaHeight
          boxel-message-gap=messageStyle.boxelMessageGap
          boxel-message-margin-left=messageStyle.boxelMessageMarginLeft
        }}
      >
        {{! template-lint-disable no-triple-curlies }}
        {{{@model.formattedMessage}}}

        {{#if @model.attachedCard}}
          <this.cardComponent />
        {{/if}}
      </BoxelMessage>
    </template>

    get timestamp() {
      if (!this.args.model.created) {
        throw new Error(`message created time is undefined`);
      }
      return this.args.model.created.getTime();
    }

    get cardComponent() {
      if (!this.args.model.attachedCard) {
        return;
      }
      return this.args.model.attachedCard.constructor.getComponent(
        this.args.model.attachedCard,
        'isolated'
      );
    }
  };
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};
}
interface RoomState {
  name?: string;
  creator?: RoomMemberCard;
  created?: number;
}
const eventCache = new WeakMap<MatrixRoomCard, Map<string, MatrixEvent>>();
const messageCache = new WeakMap<MarkdownCard, Map<string, MessageCard>>();
const roomMemberCache = new WeakMap<
  MarkdownCard,
  Map<string, RoomMemberCard>
>();
const roomStateCache = new WeakMap<MarkdownCard, RoomState>();

export class MatrixRoomCard extends Card {
  // the only writeable field for this card should be the "events" field.
  // All other fields should derive from the "events" field.
  @field events = containsMany(MatrixEventCard);

  // This works well for synchronous computeds only
  @field newEvents = containsMany(MatrixEventCard, {
    computeVia: function (this: MatrixRoomCard) {
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

  @field roomId = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      return this.events.length > 0 ? this.events[0].room_id : undefined;
    },
  });

  @field name = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      let roomState = roomStateCache.get(this);
      if (!roomState) {
        roomState = {} as RoomState;
        roomStateCache.set(this, roomState);
      }
      let name = roomState.name;
      // room name can change so we need to check new
      // events for a room name even if we already have one
      let events = this.newEvents
        .filter((e) => e.type === 'm.room.name')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as
        | RoomNameEvent[];
      if (events.length > 0) {
        roomState.name = name ?? events.pop()!.content.name;
        return roomState.name;
      }
      return; // this should never happen
    },
  });

  @field creator = contains(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
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
        roomState.creator = upsertRoomMember(this, event.sender);
        return roomState.creator;
      }
      return; // this should never happen
    },
  });

  @field created = contains(DateTimeCard, {
    computeVia: function (this: MatrixRoomCard) {
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
        return new Date(roomState.created);
      }
      return; // this should never happen
    },
  });

  @field roomMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      let roomMembers = roomMemberCache.get(this);
      if (!roomMembers) {
        roomMembers = new Map();
        roomMemberCache.set(this, roomMembers);
      }

      for (let event of this.newEvents.sort(
        // it's really important to process membership events chronologically
        (a, b) => a.origin_server_ts - b.origin_server_ts
      )) {
        if (event.type !== 'm.room.member') {
          continue;
        }
        let userId = event.state_key;
        upsertRoomMember(
          this,
          userId,
          event.content.displayname,
          event.content.membership
        );
      }
      return [...roomMembers.values()];
    },
  });

  @field messages = containsMany(MessageCard, {
    isUsed: true, // TODO we should not have to set this--need to research this issue
    computeVia: async function (this: MatrixRoomCard) {
      let cache = messageCache.get(this);
      if (!cache) {
        cache = new Map();
        messageCache.set(this, cache);
      }
      let index = cache.size;
      let newMessages = new Map<string, MessageCard>();
      for (let event of this.events) {
        if (event.type !== 'm.room.message') {
          continue;
        }
        if (cache.has(event.event_id)) {
          continue;
        }

        let cardArgs = {
          author: upsertRoomMember(this, event.sender),
          created: new Date(event.origin_server_ts),
          message: event.content.body,
          formattedMessage: event.content.formatted_body,
          index,
          attachedCard: null,
        };
        if (event.content.msgtype === 'org.boxel.card') {
          let cardDoc = event.content.instance;
          let attachedCard: Promise<Card> | undefined;
          if (cardDoc.data.id != null) {
            attachedCard = attachedCards.get(cardDoc.data.id);
          }
          if (!attachedCard) {
            attachedCard = createFromSerialized<typeof Card>(
              cardDoc.data,
              cardDoc,
              undefined
            );
            if (cardDoc.data.id != null) {
              attachedCards.set(cardDoc.data.id, attachedCard);
            }
          }
          newMessages.set(
            event.event_id,
            new MessageCard({ ...cardArgs, attachedCard: await attachedCard })
          );
        } else {
          newMessages.set(event.event_id, new MessageCard(cardArgs));
        }

        index++;
      }
      // need to get the cache again as we have crossed an async boundary,
      // and cache may have changed
      let updatedCache = messageCache.get(this)!; // this should always have an entry as we initialized it at the beginning of the computed
      for (let [eventId, message] of newMessages) {
        if (!updatedCache.has(eventId)) {
          updatedCache.set(eventId, message);
        }
      }
      // this sort should hopefully be very optimized since events will
      // be close to chronological order
      return [...updatedCache.values()].sort(
        (a, b) => a.created.getTime() - b.created.getTime()
      );
    },
  });

  @field joinedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      return this.roomMembers.filter((m) => m.membership === 'join');
    },
  });

  @field invitedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      return this.roomMembers.filter((m) => m.membership === 'invite');
    },
  });

  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div>Cannot edit room card</div>
    </template>
  };
}

interface BaseMatrixEvent {
  sender: string;
  origin_server_ts: number;
  event_id: string;
  room_id: string;
  unsigned: {
    age: number;
    prev_content?: any;
    prev_sender?: string;
  };
}

interface RoomStateEvent extends BaseMatrixEvent {
  state_key: string;
  unsigned: {
    age: number;
    prev_content?: any;
    prev_sender?: string;
    replaces_state?: string;
  };
}

interface RoomCreateEvent extends RoomStateEvent {
  type: 'm.room.create';
  content: {
    creator: string;
    room_version: string;
  };
}

interface RoomNameEvent extends RoomStateEvent {
  type: 'm.room.name';
  content: {
    name: string;
  };
}

interface RoomTopicEvent extends RoomStateEvent {
  type: 'm.room.topic';
  content: {
    topic: string;
  };
}

interface InviteEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'invite';
    displayname: string;
  };
}

interface JoinEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'join';
    displayname: string;
  };
}

interface LeaveEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'leave';
    displayname: string;
  };
}

interface MessageEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: {
    msgtype: 'm.text';
    format: 'org.matrix.custom.html';
    body: string;
    formatted_body: string;
  };
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

interface CardMessageEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: {
    msgtype: 'org.boxel.card';
    format: 'org.matrix.custom.html';
    body: string;
    formatted_body: string;
    instance: LooseSingleCardDocument;
  };
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export type MatrixEvent =
  | RoomCreateEvent
  | MessageEvent
  | CardMessageEvent
  | RoomNameEvent
  | RoomTopicEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent;
