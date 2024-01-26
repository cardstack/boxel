import {
  contains,
  containsMany,
  field,
  Component,
  primitive,
  useIndexBasedKey,
  FieldDef,
  type CardDef,
} from './card-api';
import StringField from './string';
import DateTimeField from './datetime';
import NumberField from './number';
import MarkdownField from './markdown';
import Modifier from 'ember-modifier';
import {
  Loader,
  getCard,
  type LooseSingleCardDocument,
  type CodeRef,
} from '@cardstack/runtime-common';
//@ts-expect-error cached type not available yet
import { cached } from '@glimmer/tracking';

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

class JSONView extends Component<typeof MatrixEventField> {
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

class RoomMemberView extends Component<typeof RoomMemberField> {
  <template>
    <div class='container'>
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
    </div>
    <style>
      .container {
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class RoomMembershipField extends FieldDef {
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

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};

export class RoomMemberField extends FieldDef {
  @field userId = contains(StringField);
  @field roomId = contains(StringField);
  @field displayName = contains(StringField);
  @field membership = contains(RoomMembershipField);
  @field membershipDateTime = contains(DateTimeField);
  @field membershipInitiator = contains(StringField);
  @field name = contains(StringField, {
    computeVia: function (this: RoomMemberField) {
      return this.displayName ?? this.userId?.split(':')[0].substring(1);
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

function getCardComponent(card: CardDef) {
  return card.constructor.getComponent(card, 'atom');
}

class EmbeddedMessageField extends Component<typeof MessageField> {
  <template>
    <div
      {{ScrollIntoView}}
      data-test-message-idx={{@model.index}}
      data-test-message-cards
    >
      {{#each @model.attachedResources as |cardResource|}}
        {{#if cardResource.cardError}}
          <div data-test-card-error={{cardResource.cardError.id}} class='error'>
            Error: cannot render card
            {{cardResource.cardError.id}}:
            {{cardResource.cardError.error.message}}
          </div>
        {{else if cardResource.card}}
          {{#let (getCardComponent cardResource.card) as |CardComponent|}}
            <div data-test-message-card={{cardResource.card.id}}>
              <CardComponent />
            </div>
          {{/let}}
        {{/if}}
      {{/each}}
    </div>

    <style>
      .error {
        color: var(--boxel-danger);
        font-weight: 'bold';
      }
    </style>
  </template>

  get timestamp() {
    if (!this.args.model.created) {
      throw new Error(`message created time is undefined`);
    }
    return this.args.model.created.getTime();
  }
}

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

export type PatchObject = { patch: { attributes: JSONObject }; id: string };

class PatchObjectField extends FieldDef {
  static [primitive]: PatchObject;
}

class CommandType extends FieldDef {
  static [primitive]: 'patch';
}

// Subclass, add a validator that checks the fields required?
class PatchField extends FieldDef {
  @field commandType = contains(CommandType);
  @field payload = contains(PatchObjectField);
}

export class MessageField extends FieldDef {
  @field author = contains(RoomMemberField);
  @field message = contains(MarkdownField);
  @field formattedMessage = contains(StringField);
  @field created = contains(DateTimeField);
  @field attachedCardIds = containsMany(StringField);
  @field index = contains(NumberField);
  @field transactionId = contains(StringField);
  @field command = contains(PatchField);

  static embedded = EmbeddedMessageField;
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends JSONView {};

  @cached
  get attachedResources(): AttachedCardResource[] | undefined {
    if (!this.attachedCardIds?.length) {
      return undefined;
    }
    let cards = this.attachedCardIds.map((id) => {
      let card = getCard(new URL(id));
      if (!card) {
        return {
          card: undefined,
          cardError: {
            id,
            error: new Error(`cannot find card for id "${id}"`),
          },
        };
      }
      return card;
    });
    return cards;
  }
}

interface RoomState {
  name?: string;
  creator?: RoomMemberField;
  created?: number;
}

// in addition to acting as a cache, this also ensures we have
// triple equal equivalence for the interior cards of RoomField
const eventCache = new WeakMap<RoomField, Map<string, MatrixEvent>>();
const messageCache = new WeakMap<RoomField, Map<string, MessageField>>();
const roomMemberCache = new WeakMap<RoomField, Map<string, RoomMemberField>>();
const roomStateCache = new WeakMap<RoomField, RoomState>();

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

      for (let event of this.newEvents) {
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
          // These are not guaranteed to exist in the event
          transactionId: event.unsigned?.transaction_id || null,
          attachedCard: null,
          command: null,
        };
        let messageField = undefined;
        if (event.content.msgtype === 'org.boxel.card') {
          let cardDocs = event.content.data.instances;
          let attachedCardIds: string[] = [];
          cardDocs.map((c) => {
            if (c.data.id) {
              attachedCardIds.push(c.data.id);
            }
          });
          if (attachedCardIds.length === 0) {
            throw new Error(`cannot handle cards in room without an ID`);
          }
          messageField = new MessageField({
            ...cardArgs,
            attachedCardIds,
          });
        } else if (event.content.msgtype === 'org.boxel.command') {
          // We only handle patches for now
          let command = event.content.data.command;
          if (command.type !== 'patch') {
            throw new Error(
              `cannot handle commands in room with type ${command.type}`,
            );
          }
          messageField = new MessageField({
            ...cardArgs,
            command: new PatchField({
              commandType: command.type,
              payload: command,
            }),
          });
        } else {
          messageField = new MessageField(cardArgs);
        }
        newMessages.set(event_id, messageField);
        index++;
      }

      // upodate the cache with the new messages
      for (let [eventId, message] of newMessages) {
        cache.set(eventId, message);
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
    data: {
      command: any;
    };
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
    data: {
      instances: LooseSingleCardDocument[];
    };
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
    ref: CodeRef;
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
