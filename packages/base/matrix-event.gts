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
  APP_BOXEL_ORIGINATING_DEVICE_ID_KEY,
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
  [APP_BOXEL_ORIGINATING_DEVICE_ID_KEY]?: string;
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
    // What the provider billed for the turn that produced this message. Only
    // on the bot's own messages, and only once the model has reported it —
    // the counts arrive at the end of the stream, so they land on a late
    // edit, not on the event that started the message.
    usage?: TokenUsage;
  };
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  // How many of promptTokens were served from the provider's prompt cache
  // (billed at a fraction of the fresh-input price). Absent when the
  // provider reports no cache detail.
  cachedTokens?: number;
  // What the provider charged for the whole request, in USD. Absent when
  // the provider reports no inline cost.
  costUsd?: number;
  // Which upstream provider served the request (the router's routing
  // target). Prompt caches live per provider, so a surprising cache miss is
  // attributable when this changes between turns. Absent when unreported.
  provider?: string;
  // The router-side generation id for the request, for post-hoc lookup of
  // routing and cache detail. Absent when unreported.
  generationId?: string;
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

// One tool definition the bot discovered by reading a skill markdown file
// (readRealmFile): the entry from the skill's indexed frontmatter, tagged
// with the skill file it came from. Embedded on the read's result event so
// prompt assembly can offer the tool on later turns from room events alone
// (event-sourced, replay-correct), and so execution can verify a call
// against the declaring skill's indexed frontmatter via `sourceSkillUrl`.
export interface DiscoveredToolDefinition {
  // The skill markdown file the definition came from (the readRealmFile URL).
  sourceSkillUrl: string;
  codeRef?: { module?: string; name?: string };
  functionName?: string;
  requiresApproval?: boolean;
  // The ready-to-use LLM tool definition stamped on the skill's file-meta.
  definition: Tool;
}

export interface ToolResultWithOutputContent {
  'm.relates_to': {
    rel_type: ToolResultRelType;
    key: ToolResultStatus;
    event_id: string;
  };
  commandRequestId: string;
  // Present if status is 'failed' or 'invalid', or on an 'applied' result
  // where part of the work failed (e.g. a multi-file read that fetched only
  // some of its files, or a skill read whose declared tools lack usable
  // indexed definitions and so cannot be offered).
  failureReason?: string;
  data: {
    // we retrieve the content on the server side by downloading the file
    card?: SerializedFile & { content?: string; error?: string };
    context?: BoxelContext;
    attachedFiles?: (SerializedFile & { content?: string; error?: string })[];
    attachedCards?: (SerializedFile & { content?: string; error?: string })[];
    // Tool definitions discovered by the read this result reports (present
    // only on readRealmFile results whose files carried usable definitions).
    // Timeline rendering ignores this key; prompt assembly's getTools reads
    // it.
    discoveredTools?: DiscoveredToolDefinition[];
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
  // The deduped adoption chains of every row the pass touched, in the same
  // `internalKeyFor` spelling `boxel_index.types` stores and a type filter
  // compiles to. A live query anchored on a type that appears nowhere in here
  // cannot have gained or lost a member, so it can sit the event out. Deduped
  // across the pass rather than carried per URL: the question a subscriber
  // asks is "was anything of a type I care about touched?", never "which
  // card?", so the set is bounded by the realm's type count while
  // `invalidations` is bounded by its row count. Absent when the pass could
  // not report it (an older worker mid-deploy, a failed pass, a full
  // reindex), which means nothing can be ruled out and every subscriber
  // re-runs.
  invalidatedTypes?: string[];
  clientRequestId?: string | null;
  // Which of `invalidations` this request wrote from content its client
  // supplied verbatim, rather than from state the realm computed. A client
  // recognizing `clientRequestId` as its own already holds what these cards
  // say — and may hold something newer still, edited while the write was in
  // flight — so re-reading them is how an edit gets lost. Every other
  // invalidation in the same pass reports state only the realm has.
  //
  // Empty and absent mean different things. Empty is a writer reporting that
  // it authored none of what it wrote — a batch that only transformed cards,
  // say — so every card in the pass holds state the realm computed and every
  // one of them wants re-reading. Absent is a writer that does not report on
  // the question at all, which leaves a client with only the request id to go
  // on, as it had before this member existed.
  clientAuthored?: string[];
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
