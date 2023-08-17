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
import NumberCard from './number';
import MarkdownCard from './markdown';
import { BoxelMessage } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { formatRFC3339 } from 'date-fns';
import Modifier from 'ember-modifier';
import {
  Loader,
  type LooseSingleCardDocument,
  type CardRef,
} from '@cardstack/runtime-common';

type VersionData = {
  eventId: string;
  serverTimeOrigin: number;
};
const cardVersions = new Map<Card, VersionData>();

// this is so we can have triple equals equivalent room member cards
function upsertRoomMember({
  roomCard,
  userId,
  displayName,
  membership,
  membershipTs,
  membershipInitiator,
}: {
  roomCard: RoomCard;
  userId: string;
  displayName?: string;
  membership?: 'invite' | 'join' | 'leave';
  membershipTs?: number;
  membershipInitiator?: string;
}): RoomMemberCard {
  let roomMembers = roomMemberCache.get(roomCard);
  if (!roomMembers) {
    roomMembers = new Map();
    roomMemberCache.set(roomCard, roomMembers);
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
    member = new RoomMemberCard({
      id: userId,
      userId,
      roomId: roomCard.roomId,
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

export class RoomMemberCard extends Card {
  @field userId = contains(StringCard);
  @field roomId = contains(StringCard);
  @field displayName = contains(StringCard);
  @field membership = contains(RoomMembershipCard);
  @field membershipDateTime = contains(DateTimeCard);
  @field membershipInitiator = contains(StringCard);
  @field name = contains(StringCard, {
    computeVia: function (this: RoomMemberCard) {
      return this.displayName ?? this.userId.split(':')[0].substring(1);
    },
  });
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

export class MessageCard extends Card {
  @field author = contains(RoomMemberCard);
  @field message = contains(MarkdownCard);
  @field formattedMessage = contains(StringCard);
  @field created = contains(DateTimeCard);
  @field attachedCard = contains(Card);
  @field index = contains(NumberCard);
  @field command = contains(StringCard);

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
        'isolated',
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

// in addition to acting as a cache, this also ensures we have
// triple equal equivalence for the interior cards of RoomCard
const eventCache = new WeakMap<RoomCard, Map<string, MatrixEvent>>();
const messageCache = new WeakMap<RoomCard, Map<string, MessageCard>>();
const roomMemberCache = new WeakMap<RoomCard, Map<string, RoomMemberCard>>();
const roomStateCache = new WeakMap<RoomCard, RoomState>();

export class RoomCard extends Card {
  // This can be used  to get the version of `cardInstance` like:
  // Reflect.getProtypeOf(roomCardInstance).constructor.getVersion(cardInstance);
  // Note: this does make a SERIOUS assumption about time
  // Events from different homeservers may be different
  static getVersion(card: Card) {
    return cardVersions.get(card)?.serverTimeOrigin;
  }

  // the only writeable field for this card should be the "events" field.
  // All other fields should derive from the "events" field.
  @field events = containsMany(MatrixEventCard);

  // This works well for synchronous computeds only
  @field newEvents = containsMany(MatrixEventCard, {
    computeVia: function (this: RoomCard) {
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
    computeVia: function (this: RoomCard) {
      return this.events.length > 0 ? this.events[0].room_id : undefined;
    },
  });

  @field name = contains(StringCard, {
    computeVia: function (this: RoomCard) {
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
        .sort(
          (a, b) => a.origin_server_ts - b.origin_server_ts,
        ) as RoomNameEvent[];
      if (events.length > 0) {
        roomState.name = name ?? events.pop()!.content.name;
      }
      return roomState.name;
    },
  });

  @field creator = contains(RoomMemberCard, {
    computeVia: function (this: RoomCard) {
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
          roomCard: this,
          userId: event.sender,
        });
      }
      return roomState.creator;
    },
  });

  @field created = contains(DateTimeCard, {
    computeVia: function (this: RoomCard) {
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

  @field roomMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomCard) {
      let roomMembers = roomMemberCache.get(this);
      if (!roomMembers) {
        roomMembers = new Map();
        roomMemberCache.set(this, roomMembers);
      }

      for (let event of this.newEvents) {
        if (event.type !== 'm.room.member') {
          continue;
        }
        let userId = event.state_key;
        upsertRoomMember({
          roomCard: this,
          userId,
          displayName: event.content.displayname,
          membership: event.content.membership,
          membershipTs: event.origin_server_ts,
          membershipInitiator: event.sender,
        });
      }
      return [...roomMembers.values()];
    },
  });

  @field messages = containsMany(MessageCard, {
    // since we are rendering this card without the isolated renderer, we cannot use
    // the rendering mechanism to test if a field is used or not, so we explicitely
    // tell the card runtime that this field is being used
    isUsed: true,
    computeVia: async function (this: RoomCard) {
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
      let newMessages = new Map<string, MessageCard>();
      for (let event of this.events) {
        if (this.roomId == event.room_id) {
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

          let author = upsertRoomMember({
            roomCard: this,
            userId: event.sender,
          });
          let formattedMessage =
            event.content.msgtype === 'org.boxel.objective'
              ? `<em>${author.name} has set the room objectives</em>`
              : event.content.formatted_body;
          let cardArgs = {
            author,
            created: new Date(event.origin_server_ts),
            message: event.content.body,
            formattedMessage,
            index,
            attachedCard: null,
            command: null,
          };
          if (event.content.msgtype === 'org.boxel.command') {
            cardArgs['command'] = event.content.command;
          }
          if (event.content.msgtype === 'org.boxel.card') {
            let cardDoc = event.content.instance;
            if (cardDoc.data.id == null) {
              throw new Error(`cannot handle cards in room without an ID`);
            }
            let attachedCard = await createFromSerialized<typeof Card>(
              cardDoc.data,
              cardDoc,
              new URL(cardDoc.data.id),
              loader,
            );
            newMessages.set(
              event_id,
              new MessageCard({ ...cardArgs, attachedCard }),
            );
            cardVersions.set(attachedCard, {
              eventId: event_id,
              serverTimeOrigin: event.origin_server_ts,
            });
          } else {
            newMessages.set(event_id, new MessageCard(cardArgs));
          }
        }

        index++;
      }
      // need to get the cache again as we have crossed an async boundary,
      // and cache may have changed
      let updatedCache = messageCache.get(this)!; // this should always have an entry as we initialized it at the beginning of the computed
      for (let [eventId, message] of newMessages) {
        updatedCache.set(eventId, message);
      }
      // this sort should hopefully be very optimized since events will
      // be close to chronological order
      return [...updatedCache.values()].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
      );
    },
  });

  @field joinedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomCard) {
      return this.roomMembers.filter((m) => m.membership === 'join');
    },
  });

  @field invitedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomCard) {
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
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
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

interface CommandEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: {
    command: any;
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
    msgtype: 'org.boxel.command';
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
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
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

interface ObjectiveEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: {
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
    msgtype: 'org.boxel.objective';
    body: string;
    ref: CardRef;
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
  | CommandEvent
  | CardMessageEvent
  | ObjectiveEvent
  | RoomNameEvent
  | RoomTopicEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent;
