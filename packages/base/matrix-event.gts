import type { EventStatus, MatrixError } from 'matrix-js-sdk';
import type {
  AttributesSchema,
  ToolChoice,
} from '@cardstack/runtime-common/helpers/ai';
import type { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  APP_BOXEL_PR_EVENT_TYPE,
  APP_BOXEL_PR_REVIEW_EVENT_TYPE,
  CodeRef,
  APP_BOXEL_LLM_MODE,
  type LLMMode,
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
    isCanceled?: boolean;
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

export interface DebugMessageEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE;
  content: CardMessageContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

// Synapse JSON does not support decimals, so we encode all arguments as stringified JSON
export type EncodedCommandRequest = Omit<CommandRequest, 'arguments'> & {
  arguments: string;
};

export interface BoxelErrorForContext {
  message: string;
  stack?: string;
  sourceUrl?: string;
}

export interface BoxelContext {
  agentId?: string;
  openCardIds?: string[];
  realmUrl?: string;
  realmPermissions?: {
    canRead: boolean;
    canWrite: boolean;
  };
  errorsDisplayed?: BoxelErrorForContext[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  submode?: string;
  workspaces?: {
    url: string;
    name: string;
    type: 'user-workspace' | 'catalog-workspace';
  }[];
  codeMode?: {
    currentFile?: string;
    moduleInspectorPanel?: string;
    previewPanelSelection?: {
      cardId: string;
      format: string;
    };
    selectedCodeRef?: CodeRef;
    inheritanceChain?: {
      codeRef: CodeRef;
      fields: string[];
    }[];
    selectionRange?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    };
    activeSpecId?: string;
  };
  debug?: boolean;
  requireToolCall?: boolean;
  functions?: Tool['function'][];
}

export interface CardMessageContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype:
    | typeof APP_BOXEL_MESSAGE_MSGTYPE
    | typeof APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE;
  format: 'org.matrix.custom.html';
  body: string;
  isStreamingFinished?: boolean;
  isCanceled?: boolean;
  [APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]?: boolean;
  [APP_BOXEL_CONTINUATION_OF_CONTENT_KEY]?: string; // event_id of the message we are continuing
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
    context?: BoxelContext;
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
    toolsSupported?: boolean;
    reasoningEffort?: string;
  };
}

export interface LLMModeEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_LLM_MODE;
  content: {
    mode: LLMMode;
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

export interface CodePatchResultEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE;
  content: CodePatchResultContent;
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

export type CommandResultStatus = 'applied' | 'failed' | 'invalid';

export interface CommandResultWithOutputContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_COMMAND_RESULT_REL_TYPE;
    key: CommandResultStatus;
    event_id: string;
  };
  commandRequestId: string;
  failureReason?: string; // only present if status is 'failed' or 'invalid'
  data: {
    // we retrieve the content on the server side by downloading the file
    card?: SerializedFile & { content?: string; error?: string };
    context?: BoxelContext;
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE;
}

export interface CommandResultWithNoOutputContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_COMMAND_RESULT_REL_TYPE;
    key: CommandResultStatus;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE;
  commandRequestId: string;
  failureReason?: string; // only present if status is 'failed' or 'invalid'
  data: {
    context?: BoxelContext;
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
  };
}

export type CodePatchStatus = 'applied' | 'failed'; // possibly add 'rejected' in the future

export interface CodePatchResultContent {
  'm.relates_to': {
    rel_type: typeof APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE;
    key: CodePatchStatus;
    event_id: string;
  };
  msgtype: typeof APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE;
  codeBlockIndex: number;
  failureReason?: string; // only present if status is 'failed'
  data: {
    context?: BoxelContext;
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
  };
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

export interface IncrementalIndexInitiationContent {
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

export interface PRReviewEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_PR_REVIEW_EVENT_TYPE;
  content: PRReviewEventContent;
}

export interface PRReviewEventContent {
  action: 'submitted' | 'edited' | 'dismissed';
  state: 'approved' | 'changes_requested' | 'commented';
  pullRequest: {
    number: number;
    title?: string;
    url?: string;
    htmlUrl?: string;
    author?: string;
    branch?: string;
    baseBranch?: string;
    merged?: boolean;
    state?: 'open' | 'closed';
  };
}

export interface PREvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_PR_EVENT_TYPE;
  content: PREventContent;
}

export interface PREventContent {
  action: 'opened' | 'closed' | 'reopened' | 'synchronize';
  pullRequest: {
    number: number;
    title?: string;
    url?: string;
    htmlUrl?: string;
    author?: string;
    branch?: string;
    baseBranch?: string;
    merged?: boolean;
    state?: 'open' | 'closed';
  };
}

export interface StopGeneratingEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_STOP_GENERATING_EVENT_TYPE;
}

export type MatrixEventWithBoxelContext =
  | CardMessageEvent
  | CommandResultEvent
  | CodePatchResultEvent;

export type MatrixEvent =
  | ActiveLLMEvent
  | CardMessageEvent
  | CodePatchResultEvent
  | CommandResultEvent
  | DebugMessageEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent
  | LLMModeEvent
  | MessageEvent
  | PREvent
  | PRReviewEvent
  | RealmEvent
  | RealmServerEvent
  | RoomCreateEvent
  | RoomJoinRules
  | RoomNameEvent
  | RoomPowerLevels
  | RoomTopicEvent
  | SkillsConfigEvent;
