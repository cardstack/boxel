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

class EventView extends Component<typeof MatrixEventCard> {
  <template>
    <pre>{{this.json}}</pre>
  </template>

  get json() {
    return JSON.stringify(this.args.model, null, 2);
  }
}

class MatrixEventCard extends CardBase {
  static [primitive]: MatrixEvent;
  static embedded = class Isolated extends EventView {};
  static isolated = class Isolated extends EventView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends EventView {};
}
class IsolatedRoomView extends Component<typeof MatrixRoomCard> {
  <template>

  </template>
}

class MessageCard extends Card {
  @field author = contains(StringCard);
  @field message = contains(MarkdownCard);
  @field created = contains(DateTimeCard);
  @field attachedCard = contains(Card);
}

export class MatrixRoomCard extends Card {
  // the only writeable field for this card should be the "events" field.
  // All other fields should derive from the "events" field.
  @field events = containsMany(MatrixEventCard);

  @field roomId = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {},
  });

  @field name = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {},
  });

  @field creator = contains(StringCard, {
    computeVia: function (this: MatrixRoomCard) {},
  });

  @field created = contains(DateTimeCard, {
    computeVia: function (this: MatrixRoomCard) {},
  });

  @field messages = containsMany(MessageCard, {
    computeVia: function (this: MatrixRoomCard) {},
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

  static embedded = class Embedded extends Component<typeof this> {
    <template>

    </template>
  };

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
