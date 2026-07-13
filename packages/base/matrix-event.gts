import type { EventStatus, MatrixError } from 'matrix-js-sdk';
import type {
  AttributesSchema,
  ToolChoice,
} from '@cardstack/runtime-common/helpers/ai';
import type { CommandRequest } from '@cardstack/runtime-common/commands';
import type {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY,
  ToolResultEventType,
  ToolResultRelType,
  ToolResultWithNoOutputMsgtype,
  ToolResultWithOutputMsgtype,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  CodeRef,
  APP_BOXEL_LLM_MODE,
} from '@cardstack/runtime-common';
import type {
  LLMMode,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { SerializedFile } from './file-api';

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
export type EncodedToolRequest = Omit<CommandRequest, 'arguments'> & {
  arguments: string;
};

export interface BoxelErrorForContext {
  message: string;
  stack?: string;
  sourceUrl?: string;
  // CS-10977: optional structured payload carried alongside the message/stack
  // so consumers (CopyButton, AI assistant, error context) can include the
  // captured browser console errors and prerender diagnostics that the
  // render runner attached to the error doc.
  additionalErrors?: Array<{
    message?: string;
    stack?: string;
    status?: number;
    title?: string;
  }> | null;
  diagnostics?: Record<string, unknown>;
}

export interface BoxelContext {
  agentId?: string;
  openCardIds?: RealmResourceIdentifier[];
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
      cardId: RealmResourceIdentifier;
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
  [APP_BOXEL_TOOL_REQUESTS_KEY]?: Partial<EncodedToolRequest>[];
  // Replay-only: messages written before the command → tool rename carry
  // their requests under this key. Read via `getToolRequests`; never write.
  [LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY]?: Partial<EncodedToolRequest>[];
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
    toolDefinitions?: SerializedFile[];
    // Replay-only: state written before the command → tool rename. Read via
    // `getToolDefinitions`; never write.
    commandDefinitions?: SerializedFile[];
  };
}

export interface ActiveLLMEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_ACTIVE_LLM;
  content: {
    model: string;
    toolsSupported?: boolean;
    reasoningEffort?: string;
    inputModalities?: string[];
  };
}

export interface LLMModeEvent extends RoomStateEvent {
  type: typeof APP_BOXEL_LLM_MODE;
  content: {
    mode: LLMMode;
  };
}

export interface ToolResultEvent extends BaseMatrixEvent {
  type: ToolResultEventType;
  content: ToolResultWithOutputContent | ToolResultWithNoOutputContent;
  unsigned: {
    age: number;
    transaction_id: string;
    prev_content?: any;
    prev_sender?: string;
  };
}

export const BOT_TRIGGER_EVENT_TYPE = 'app.boxel.bot-trigger';

export interface BotTriggerContent {
  type: string;
  realm: string;
  input: unknown;
  userId: string;
}

export interface BotTriggerEvent extends BaseMatrixEvent {
  type: typeof BOT_TRIGGER_EVENT_TYPE;
  content: BotTriggerContent;
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

export interface ToolDefinitionSchema {
  codeRef: {
    module: string;
    name: string;
  };
  tool: Tool;
}

export type ToolResultStatus = 'applied' | 'failed' | 'invalid';

export interface ToolResultWithOutputContent {
  'm.relates_to': {
    rel_type: ToolResultRelType;
    key: ToolResultStatus;
    event_id: string;
  };
  commandRequestId: string;
  // Present if status is 'failed' or 'invalid', or on an 'applied' result
  // where part of the work failed (e.g. a multi-file read that fetched only
  // some of its files).
  failureReason?: string;
  data: {
    // we retrieve the content on the server side by downloading the file
    card?: SerializedFile & { content?: string; error?: string };
    context?: BoxelContext;
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
  };
  msgtype: ToolResultWithOutputMsgtype;
}

export interface ToolResultWithNoOutputContent {
  'm.relates_to': {
    rel_type: ToolResultRelType;
    key: ToolResultStatus;
    event_id: string;
  };
  msgtype: ToolResultWithNoOutputMsgtype;
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
    lintIssues?: string[];
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
  | PrerenderHtmlEventContent
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
  // The realm generation the indexing pass committed. Lets a consumer correlate
  // this search-doc update with the prerendered HTML that belongs to it.
  generation?: number;
  realmURL: string;
}

interface FullIndexEventContent {
  eventName: 'index';
  indexType: 'full';
  generation?: number;
  realmURL: string;
}

interface CopiedIndexEventContent {
  eventName: 'index';
  indexType: 'copy';
  sourceRealmURL: string;
  generation?: number;
  realmURL: string;
}

// Prerendered HTML for the listed URLs has landed at `generation`, on its own
// channel after (or concurrently with) the indexing pass. Emitted by the
// `prerender_html` worker job through the worker-event bridge so open live
// searches re-run and pick up the fresh HTML / corrected full-text membership.
export interface PrerenderHtmlEventContent {
  eventName: 'prerender_html';
  invalidations: string[];
  generation: number;
  realmURL: string;
}

export interface IncrementalIndexInitiationContent {
  eventName: 'index';
  indexType: 'incremental-index-initiation';
  updatedFile: string;
  realmURL: string;
}

export interface UpdateRealmEventContent {
  eventName: 'update';
  added?: string[];
  updated?: string[];
  removed?: string[];
  realmURL: string;
}

// File watcher events are single-file and don't include realmURL
export type FileWatcherEventContent =
  | { eventName: 'update'; added: string }
  | { eventName: 'update'; updated: string }
  | { eventName: 'update'; removed: string };

export interface StopGeneratingEvent extends BaseMatrixEvent {
  type: typeof APP_BOXEL_STOP_GENERATING_EVENT_TYPE;
}

export type MatrixEventWithBoxelContext =
  | CardMessageEvent
  | ToolResultEvent
  | CodePatchResultEvent;

export type MatrixEvent =
  | ActiveLLMEvent
  | BotTriggerEvent
  | CardMessageEvent
  | CodePatchResultEvent
  | ToolResultEvent
  | DebugMessageEvent
  | InviteEvent
  | JoinEvent
  | LeaveEvent
  | LLMModeEvent
  | MessageEvent
  | RealmEvent
  | RealmServerEvent
  | RoomCreateEvent
  | RoomJoinRules
  | RoomNameEvent
  | RoomPowerLevels
  | RoomTopicEvent
  | SkillsConfigEvent;

// Pre-rename spellings; new code imports the Tool-named types. These stay
// until the ai-bot / prompt-assembly sweep (and out-of-tree content) stops
// importing them.
export type EncodedCommandRequest = EncodedToolRequest;
export type CommandDefinitionSchema = ToolDefinitionSchema;
export type CommandResultEvent = ToolResultEvent;
export type CommandResultWithOutputContent = ToolResultWithOutputContent;
export type CommandResultWithNoOutputContent = ToolResultWithNoOutputContent;
export type CommandResultStatus = ToolResultStatus;
