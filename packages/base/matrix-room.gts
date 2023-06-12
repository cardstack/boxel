import {
  contains,
  containsMany,
  field,
  Component,
  Card,
  primitive,
  CardBase,
} from './card-api';
import StringCard from './string';
import DateTimeCard from './datetime';
import MarkdownCard from './markdown';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

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

class SerializedCard extends CardBase {
  static [primitive]: LooseSingleCardDocument;
  static embedded = class Embedded extends JSONView {};
  static isolated = class Isolated extends JSONView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};
}

class MessageCard extends Card {
  @field author = contains(StringCard);
  @field message = contains(MarkdownCard);
  @field created = contains(DateTimeCard);
  @field serializedCard = contains(SerializedCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.created />
      <@fields.author />
      <@fields.message />
    </template>
  };
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};
}

class IsolatedRoomView extends Component<typeof MatrixRoomCard> {
  <template>
    <div>
      ROOM CARD:
    </div>
    <div>
      room ID:
      <@fields.roomId />
    </div>
    <div>
      name:
      <@fields.name />
    </div>
    <div>
      creator:
      <@fields.creator />
    </div>
    <div>
      created:
      <@fields.created />
    </div>
    <div>
      Messages:
      <@fields.messages />
    </div>
  </template>
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

  @field creator = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      let event = this.events.find((e) => e.type === 'm.room.create') as
        | RoomCreateEvent
        | undefined;
      if (event) {
        return event.content.creator;
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
    computeVia: function (this: MatrixRoomCard) {
      let events = this.events
        .filter((e) => e.type === 'm.room.message')
        .sort((a, b) => a.origin_server_ts - b.origin_server_ts) as
        | (MessageEvent | CardMessageEvent)[];
      return events.map((e) => {
        let cardArgs = {
          author: e.sender,
          created: new Date(e.origin_server_ts),
          message: e.content.body,
        };
        if (e.content.msgtype === 'org.boxel.card') {
          let attachedCard = e.content.instance.data;
          return new MessageCard({ ...cardArgs, attachedCard });
        } else {
          return new MessageCard(cardArgs);
        }
      });
    },
  });

  @field joinedMembers = containsMany(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      // TODO use the member matrix handler for this logic
    },
  });

  @field invitedMembers = containsMany(StringCard, {
    computeVia: function (this: MatrixRoomCard) {
      // TODO use the member matrix handler for this logic
      // use reduce to deal with membership state transitions...
    },
  });

  static isolated = class Isolated extends IsolatedRoomView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends IsolatedRoomView {};
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

type MatrixEvent =
  | RoomCreateEvent
  | MessageEvent
  | CardMessageEvent
  | RoomNameEvent
  | RoomTopicEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent;
