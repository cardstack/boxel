import { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { EventStatus, MatrixError } from 'matrix-js-sdk';
import {
  FunctionToolCall,
  type AttributesSchema,
  type ToolChoice,
} from '@cardstack/runtime-common/helpers/ai';
import {
  APP_BOXEL_CARD_FORMAT,
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import { type SerializedFile } from './file-api';

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
  msgtype: typeof APP_BOXEL_COMMAND_MSGTYPE;
  format: 'org.matrix.custom.html';
  body: string;
  formatted_body: string;
  data: {
    toolCall: FunctionToolCall;
    eventId: string;
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

export interface CommandDefinitionsEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: CommandDefinitionsContent;
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
  msgtype: typeof APP_BOXEL_MESSAGE_MSGTYPE;
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
    attachedFiles?: SerializedFile[];
    attachedCardsEventIds?: string[];
    attachedSkillEventIds?: string[];
    // we materialize this field on the server from the card
    // fragments that we receive
    attachedCards?: LooseSingleCardDocument[];
    skillCards?: LooseSingleCardDocument[];
    context: {
      openCardIds?: string[];
      tools: Tool[];
      toolChoice?: ToolChoice;
      submode?: string;
      requireToolCall?: boolean;
    };
  };
}

export interface CardFragmentContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_CARDFRAGMENT_MSGTYPE;
  format: typeof APP_BOXEL_CARD_FORMAT;
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

export interface SkillsConfigEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_ROOM_SKILLS_EVENT_TYPE;
  content: {
    enabledEventIds: string[];
    disabledEventIds: string[];
  };
}

export interface ActiveLLMEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_ACTIVE_LLM;
  content: {
    model: string;
  };
}

export interface CommandResultEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_COMMAND_RESULT_EVENT_TYPE;
  content: CommandResultWithOutputContent | CommandResultWithNoOutputContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export interface CommandDefinitionsContent {
  msgtype: typeof APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE;
  body: string;
  data: {
    commandDefinitions: {
      codeRef: {
        module: string;
        name: string;
      };
      tool: Tool;
    }[];
  };
}
export interface CommandResultWithOutputContent {
  'm.relates_to': {
    rel_type: 'm.annotation';
    key: string;
    event_id: string;
  };
  data: {
    cardEventId: string;
    // we materialize this field on the server
    card?: LooseSingleCardDocument;
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE;
}

export interface CommandResultWithNoOutputContent {
  'm.relates_to': {
    rel_type: 'm.annotation';
    key: string;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE;
}

export interface RealmServerEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: RealmServerEventContent;
}

export interface RealmServerEventContent {
  msgtype: typeof APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE;
  body: string;
}

export interface RealmEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_REALM_EVENT_TYPE;
  content: RealmEventContent;
}

export type RealmEventContent =
  | IndexRealmEventContent
  | UpdateRealmEventContent;

export type IndexRealmEventContent =
  | IncrementalIndexEventContent
  | FullIndexEventContent
  | CopiedIndexEventContent
  | IncrementalIndexInitiationContent;

export interface IncrementalIndexEventContent {
  eventName: 'index';
  indexType: 'incremental';
  invalidations: string[];
  clientRequestId?: string | null;
}

interface FullIndexEventContent {
  eventName: 'index';
  indexType: 'full';
}

interface CopiedIndexEventContent {
  eventName: 'index';
  indexType: 'copy';
  sourceRealmURL: string;
}

interface IncrementalIndexInitiationContent {
  eventName: 'index';
  indexType: 'incremental-index-initiation';
  updatedFile: string;
}

export type UpdateRealmEventContent =
  | FileAddedEventContent
  | FileUpdatedEventContent
  | FileRemovedEventContent;

interface FileAddedEventContent {
  eventName: 'update';
  added: string;
}

interface FileUpdatedEventContent {
  eventName: 'update';
  updated: string;
}

interface FileRemovedEventContent {
  eventName: 'update';
  removed: string;
}

export type MatrixEvent =
  | RoomCreateEvent
  | RoomJoinRules
  | RoomPowerLevels
  | MessageEvent
  | CommandEvent
  | CommandResultEvent
  | CommandDefinitionsEvent
  | CardMessageEvent
  | RealmServerEvent
  | RealmEvent
  | RoomNameEvent
  | RoomTopicEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent
  | SkillsConfigEvent
  | ActiveLLMEvent;
