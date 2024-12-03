import { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { EventStatus, MatrixError } from 'matrix-js-sdk';
import {
  FunctionToolCall,
  type AttributesSchema,
} from '@cardstack/runtime-common/helpers/ai';

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
  status: EventStatus | null;
  error?: MatrixError;
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

export interface RoomCreateEvent extends RoomStateEvent {
  type: 'm.room.create';
  content: {
    creator: string;
    room_version: string;
  };
}

interface RoomJoinRules extends RoomStateEvent {
  type: 'm.room.join_rules';
  content: {
    // TODO
  };
}

interface RoomPowerLevels extends RoomStateEvent {
  type: 'm.room.power_levels';
  content: {
    // TODO
  };
}

export interface RoomNameEvent extends RoomStateEvent {
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

export interface InviteEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'invite';
    displayname: string;
  };
}

export interface JoinEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'join';
    displayname: string;
  };
}

export interface LeaveEvent extends RoomStateEvent {
  type: 'm.room.member';
  content: {
    membership: 'leave';
    displayname: string;
  };
}

export interface MessageEvent extends BaseMatrixEvent {
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
    isStreamingFinished: boolean;
    errorMessage?: string;
  };
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export interface CommandEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: CommandMessageContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export interface CommandMessageContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: 'org.boxel.command';
  format: 'org.matrix.custom.html';
  body: string;
  formatted_body: string;
  data: {
    toolCall: FunctionToolCall;
    eventId: string;
  };
}

export interface ReactionEvent extends BaseMatrixEvent {
  type: 'm.reaction';
  content: ReactionEventContent;
}

export interface ReactionEventContent {
  'm.relates_to': {
    event_id: string;
    key: string;
    rel_type: 'm.annotation';
  };
}

export interface CardMessageEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: CardMessageContent | CardFragmentContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: AttributesSchema;
  };
}

export interface CardMessageContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: 'org.boxel.message';
  format: 'org.matrix.custom.html';
  body: string;
  formatted_body: string;
  isStreamingFinished?: boolean;
  errorMessage?: string;
  // ID from the client and can be used by client
  // to verify whether the message is already sent or not.
  clientGeneratedId?: string;
  data: {
    // we use this field over the wire since the matrix message protocol
    // limits us to 65KB per message
    attachedCardsEventIds?: string[];
    attachedSkillEventIds?: string[];
    // we materialize this field on the server from the card
    // fragments that we receive
    attachedCards?: LooseSingleCardDocument[];
    skillCards?: LooseSingleCardDocument[];
    context: {
      openCardIds?: string[];
      tools: Tool[];
      submode?: string;
    };
  };
}

export interface CardFragmentContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: 'org.boxel.cardFragment';
  format: 'org.boxel.card';
  formatted_body: string;
  body: string;
  errorMessage?: string;
  data: {
    nextFragment?: string;
    cardFragment: string;
    index: number;
    totalParts: number;
  };
}

export interface CommandResultEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: CommandResultContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export interface CommandResultContent {
  'm.relates_to'?: {
    rel_type: 'm.annotation';
    key: string;
    event_id: string;
    'm.in_reply_to'?: {
      event_id: string;
    };
  };
  formatted_body: string;
  body: string;
  msgtype: 'org.boxel.commandResult';
  result: any;
}

export type MatrixEvent =
  | RoomCreateEvent
  | RoomJoinRules
  | RoomPowerLevels
  | MessageEvent
  | CommandEvent
  | CommandResultEvent
  | ReactionEvent
  | CardMessageEvent
  | RoomNameEvent
  | RoomTopicEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent;
