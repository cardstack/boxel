import {
  contains,
  containsMany,
  field,
  Component,
  Card,
  primitive,
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

const roomMembers = new Map<string, RoomMemberCard>();

// this is so we can have triple equals equivalent room member cards
function upsertRoomMember(
  userId: string,
  displayName?: string
): RoomMemberCard {
  let member = roomMembers.get(userId);
  if (!member) {
    member = new RoomMemberCard({ userId });
    roomMembers.set(userId, member);
  }

  // patch in the display name in case we don't have one yet
  // TODO need to look up the event used to change the display name
  if (displayName) {
    member.displayName = displayName;
  }

  return member;
}

// this is so we can have triple equals equivalent attached cards in messages
const attachedCards = new Map<string, Card>();

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
  </template>
}

class RoomMemberCard extends Card {
  @field userId = contains(StringCard);
  @field displayName = contains(StringCard);
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

export class MatrixRoomCard extends Card {
  // the only writeable field for this card should be the "events" field.
  // All other fields should derive from the "events" field.
  @field events = containsMany(MatrixEventCard);

  @field roomId = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      return this.events.length > 0 ? this.events[0].room_id : undefined;
    },
  });

  @field name = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      let events = this.events
        .filter((e) => e.type === 'm.room.name')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as
        | RoomNameEvent[];
      if (events.length > 0) {
        return events.pop()!.content.name;
      }
      return; // this should never happen
    },
  });

  @field creator = contains(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      let event = this.events.find((e) => e.type === 'm.room.create') as
        | RoomCreateEvent
        | undefined;
      if (event) {
        return upsertRoomMember(event.sender);
      }
      return; // this should never happen
    },
  });

  @field created = contains(DateTimeCard, {
    computeVia: function (this: MatrixRoomCard) {
      let event = this.events.find((e) => e.type === 'm.room.create') as
        | RoomCreateEvent
        | undefined;
      if (event) {
        let timestamp = event.origin_server_ts;
        return new Date(timestamp);
      }
      return; // this should never happen
    },
  });

  @field messages = containsMany(MessageCard, {
    isUsed: true, // TODO we should not have to set this--need to research this issue
    computeVia: async function (this: MatrixRoomCard) {
      let events = this.events
        .filter((e) => e.type === 'm.room.message')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as
        | (MessageEvent | CardMessageEvent)[];
      let messages: MessageCard[] = [];
      for (let [index, event] of events.entries()) {
        let cardArgs = {
          author: upsertRoomMember(event.sender),
          created: new Date(event.origin_server_ts),
          message: event.content.body,
          formattedMessage: event.content.formatted_body,
          index,
          attachedCard: null,
        };
        if (event.content.msgtype === 'org.boxel.card') {
          let cardDoc = event.content.instance;
          let attachedCard: Card | undefined;
          if (cardDoc.data.id != null) {
            attachedCard = attachedCards.get(cardDoc.data.id);
          }
          if (!attachedCard) {
            attachedCard = await createFromSerialized<typeof Card>(
              cardDoc.data,
              cardDoc,
              undefined
            );
            if (cardDoc.data.id != null) {
              attachedCards.set(cardDoc.data.id, attachedCard);
            }
          }
          messages.push(new MessageCard({ ...cardArgs, attachedCard }));
        } else {
          messages.push(new MessageCard(cardArgs));
        }
      }
      return messages;
    },
  });

  @field joinedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      let events = this.events
        .filter((e) => e.type === 'm.room.member')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as (
        | InviteEvent
        | JoinEvent
        | LeaveEvent
      )[];
      let joined = events.reduce((accumulator, event) => {
        let userId = event.state_key;
        switch (event.content.membership) {
          case 'invite':
            // no action here
            break;
          case 'join': {
            let member = upsertRoomMember(userId, event.content.displayname);
            accumulator.set(userId, member);
            break;
          }
          case 'leave':
            accumulator.delete(userId);
            break;
          default:
            assertNever(event.content);
        }
        return accumulator;
      }, new Map<string, RoomMemberCard>());
      return [...joined.values()];
    },
  });

  @field invitedMembers = containsMany(RoomMemberCard, {
    computeVia: function (this: MatrixRoomCard) {
      let events = this.events
        .filter((e) => e.type === 'm.room.member')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as (
        | InviteEvent
        | JoinEvent
        | LeaveEvent
      )[];
      let invited = events.reduce((accumulator, event) => {
        let userId = event.state_key;
        switch (event.content.membership) {
          case 'invite': {
            let member = upsertRoomMember(userId, event.content.displayname);
            accumulator.set(userId, member);
            break;
          }
          case 'join':
          case 'leave':
            accumulator.delete(userId);
            break;
          default:
            assertNever(event.content);
        }
        return accumulator;
      }, new Map<string, RoomMemberCard>());
      return [...invited.values()];
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

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
