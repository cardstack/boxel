import type { EventStatus, MatrixError } from 'matrix-js-sdk';
import type {
  AttributesSchema,
  ToolChoice,
} from '@cardstack/runtime-common/helpers/ai';
import type { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_APPLY_CODE_CHANGE_RESULT_MSGTYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
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

export interface CardMessageEvent extends BaseMatrixEvent {
  type: 'm.room.message';
  content: CardMessageContent;
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

// Synapse JSON does not support decimals, so we encode all arguments as stringified JSON
export type EncodedCommandRequest = Omit<CommandRequest, 'arguments'> & {
  arguments: string;
};

export interface CardMessageContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_MESSAGE_MSGTYPE;
  format: 'org.matrix.custom.html';
  body: string;
  isStreamingFinished?: boolean;
  [APP_BOXEL_REASONING_CONTENT_KEY]?: string;
  [APP_BOXEL_COMMAND_REQUESTS_KEY]?: Partial<EncodedCommandRequest>[];
  errorMessage?: string;
  // ID from the client and can be used by client
  // to verify whether the message is already sent or not.
  clientGeneratedId?: string;
  data: {
    // we retrieve the content on the server side by downloading the file
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
    context: {
      openCardIds?: string[];
      tools?: Tool[];
      toolChoice?: ToolChoice;
      submode?: string;
      requireToolCall?: boolean;
      functions: Tool['function'][];
    };
    cardEventId?: string;
    card?: LooseSingleCardDocument;
  };
}

export interface SkillsConfigEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_ROOM_SKILLS_EVENT_TYPE;
  content: {
    enabledSkillCards: SerializedFile[];
    disabledSkillCards: SerializedFile[];
    commandDefinitions?: SerializedFile[];
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
  content:
    | CommandResultWithOutputContent
    | CommandResultWithNoOutputContent
    | ApplyCodeChangeResultContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}
export interface CommandDefinitionSchema {
  codeRef: {
    module: string;
    name: string;
  };
  tool: Tool;
}

export interface CommandResultWithOutputContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_COMMAND_RESULT_REL_TYPE;
    key: string;
    event_id: string;
  };
  commandRequestId: string;
  data: {
    // we retrieve the content on the server side by downloading the file
    card?: SerializedFile & { content?: string; error?: string };
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE;
}

export interface CommandResultWithNoOutputContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_COMMAND_RESULT_REL_TYPE;
    key: string;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE;
  commandRequestId: string;
}

export interface ApplyCodeChangeResultContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_COMMAND_RESULT_REL_TYPE;
    key: 'rejected' | 'applied' | 'failed';
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_APPLY_CODE_CHANGE_RESULT_MSGTYPE;
  codeBlockIndex: number;
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

export interface FileAddedEventContent {
  eventName: 'update';
  added: string;
}

export interface FileUpdatedEventContent {
  eventName: 'update';
  updated: string;
}

export interface FileRemovedEventContent {
  eventName: 'update';
  removed: string;
}

export type MatrixEvent =
  | RoomCreateEvent
  | RoomJoinRules
  | RoomPowerLevels
  | MessageEvent
  | CommandResultEvent
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
