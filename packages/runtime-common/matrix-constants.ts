export const APP_BOXEL_STOP_GENERATING_EVENT_TYPE = 'app.boxel.stopGenerating';
export const APP_BOXEL_MESSAGE_MSGTYPE = 'app.boxel.message';
export const APP_BOXEL_CARD_FORMAT = 'app.boxel.card';

// ─── Tool wire keys (command → tool rename) ───
//
// New events are written ONLY with the tool-named keys. The LEGACY_* spellings
// exist because Matrix rooms replay their full history: events written before
// the rename carry the old keys forever, so every reader must accept both
// (the `is*` predicates and `get*` content readers below do). Never write a
// LEGACY_* key.
export const APP_BOXEL_TOOL_REQUESTS_KEY = 'app.boxel.toolRequests';
export const LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY =
  'app.boxel.commandRequests';
export const APP_BOXEL_TOOL_RESULT_EVENT_TYPE = 'app.boxel.toolResult';
export const LEGACY_APP_BOXEL_COMMAND_RESULT_EVENT_TYPE =
  'app.boxel.commandResult';
export const APP_BOXEL_TOOL_RESULT_REL_TYPE = 'app.boxel.toolAnnotation';
export const LEGACY_APP_BOXEL_COMMAND_RESULT_REL_TYPE =
  'app.boxel.commandAnnotation';
export const APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE =
  'app.boxel.toolResultWithOutput';
export const LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE =
  'app.boxel.commandResultWithOutput';
export const APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE =
  'app.boxel.toolResultWithNoOutput';
export const LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE =
  'app.boxel.commandResultWithNoOutput';

export type ToolResultEventType =
  | typeof APP_BOXEL_TOOL_RESULT_EVENT_TYPE
  | typeof LEGACY_APP_BOXEL_COMMAND_RESULT_EVENT_TYPE;
export type ToolResultRelType =
  | typeof APP_BOXEL_TOOL_RESULT_REL_TYPE
  | typeof LEGACY_APP_BOXEL_COMMAND_RESULT_REL_TYPE;
export type ToolResultWithOutputMsgtype =
  | typeof APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE
  | typeof LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE;
export type ToolResultWithNoOutputMsgtype =
  | typeof APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE
  | typeof LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE;

export function isToolResultEventType(
  type: string | undefined,
): type is ToolResultEventType {
  return (
    type === APP_BOXEL_TOOL_RESULT_EVENT_TYPE ||
    type === LEGACY_APP_BOXEL_COMMAND_RESULT_EVENT_TYPE
  );
}

export function isToolResultRelType(
  relType: string | undefined,
): relType is ToolResultRelType {
  return (
    relType === APP_BOXEL_TOOL_RESULT_REL_TYPE ||
    relType === LEGACY_APP_BOXEL_COMMAND_RESULT_REL_TYPE
  );
}

export function isToolResultWithOutputMsgtype(
  msgtype: string | undefined,
): msgtype is ToolResultWithOutputMsgtype {
  return (
    msgtype === APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE ||
    msgtype === LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
  );
}

export function isToolResultWithNoOutputMsgtype(
  msgtype: string | undefined,
): msgtype is ToolResultWithNoOutputMsgtype {
  return (
    msgtype === APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE ||
    msgtype === LEGACY_APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE
  );
}

// Content-level counterpart of isToolResultWithOutputMsgtype: narrows a
// result-content union to its with-output member (either spelling), so
// callers can read `data.card` type-safely.
export function isToolResultWithOutputContent<T extends { msgtype?: string }>(
  content: T,
): content is Extract<T, { msgtype: ToolResultWithOutputMsgtype }> {
  return isToolResultWithOutputMsgtype(content.msgtype);
}

// Reads a message content's tool requests under either spelling; the new key
// wins when both are present (possible transiently when a streaming message
// that began before a deploy is replaced after it).
export function getToolRequests<T = unknown>(
  content: Record<string, any> | undefined | null,
): T[] | undefined {
  return (
    content?.[APP_BOXEL_TOOL_REQUESTS_KEY] ??
    content?.[LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY]
  );
}

// Reads the room-skills state event's tool definitions under either key.
// Pre-rename rooms carry `commandDefinitions` until the host next rewrites the
// state event (which emits only `toolDefinitions`).
export function getToolDefinitions<T = unknown>(
  content: Record<string, any> | undefined | null,
): T[] | undefined {
  return content?.toolDefinitions ?? content?.commandDefinitions;
}
export const APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE =
  'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE = 'app.boxel.codePatchResult';
export const APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE =
  'app.boxel.codePatchAnnotation';
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE =
  'app.boxel.codePatchCorrectness';
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE =
  'app.boxel.codePatchCorrectnessAnnotation';
export const APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE = 'app.boxel.debug';
export const APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE =
  'app.boxel.realm-server-event';
export const APP_BOXEL_ROOM_SKILLS_EVENT_TYPE = 'app.boxel.room.skills';
export const APP_BOXEL_REALMS_EVENT_TYPE = 'app.boxel.realms';
export const APP_BOXEL_REALM_SERVERS_EVENT_TYPE = 'app.boxel.realm-servers';

export interface AppBoxelRealmServersContent {
  realmServers: string[];
}
export const APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE =
  'app.boxel.workspace-favorites';
export const APP_BOXEL_SYSTEM_CARD_EVENT_TYPE = 'app.boxel.system-card';
export const APP_BOXEL_REALM_EVENT_TYPE = 'app.boxel.realm-event';
export const APP_BOXEL_ACTIVE_LLM = 'app.boxel.active-llm';
export const BOT_TRIGGER_EVENT_TYPE = 'app.boxel.bot-trigger';
export const APP_BOXEL_REASONING_CONTENT_KEY = 'app.boxel.reasoning';
export const APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY =
  'app.boxel.has-continuation';
export const APP_BOXEL_CONTINUATION_OF_CONTENT_KEY =
  'app.boxel.continuation-of';

// To-device event type carrying live streaming previews of the bot's response.
// Emitted by ai-bot to the originating device only so the browser can render
// the in-flight state without landing a Matrix room edit for every ~250 ms of
// tokens; the final consolidated state still lands as a room event because
// to-device messages are ephemeral and not persisted.
export const APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE = 'app.boxel.response-stream';

export interface AppBoxelResponseStreamContent {
  roomId: string;
  // Event id of the thinking placeholder this stream will eventually replace;
  // keys the client's preview state so concurrent turns don't collide.
  parentEventId: string;
  // Monotonic per turn. Payload carries the full accumulated state (not
  // deltas), so gaps or reordering are non-fatal — last-writer-wins by sequence.
  sequence: number;
  body: string;
  reasoning: string;
  // Same wire shape as APP_BOXEL_TOOL_REQUESTS_KEY on the room event, though
  // each request's `arguments` JSON may still be partial during streaming.
  toolRequests: unknown[];
  // Set on the final preview immediately before ai-bot flushes the room edit;
  // lets the client discard preview state promptly.
  isFinal: boolean;
}
export const APP_BOXEL_LLM_MODE = 'app.boxel.llm-mode';
export const APP_BOXEL_RELOAD_BILLING_DATA_KEY = 'app.boxel.reloadBillingData';
export type LLMMode = 'ask' | 'act';
export const DEFAULT_CODING_LLM = 'anthropic/claude-sonnet-4.6';
export const DEFAULT_REMIX_LLM = 'openai/gpt-5-nano';
export const DEFAULT_IMAGE_GENERATION_LLM = 'google/gemini-2.5-flash-image';

// Realm-independent fallback model surface. Used when SystemCard /
// SystemCard.modelConfigurations is unavailable so we never ship undefined
// capability fields on the wire (silent-tools-off bug — see CS-11249).
//
// Refresh: re-derive from `https://openrouter.ai/api/v1/models` when the
// curated set changes. Derivation rules mirror the computed fields on the
// `OpenRouterModel` card (`packages/openrouter-realm/openrouter-model.gts`):
//   toolsSupported  = supportedParameters.includes('tools')
//   inputModalities = architecture.inputModalities (verbatim)
// `reasoningEffort` is intentionally not modeled here — it's a user choice,
// not a model capability. Callers / SystemCard supply it; the fallback never
// auto-fills it.
export interface FallbackModelConfig {
  modelId: string;
  displayName: string;
  toolsSupported: boolean;
  inputModalities: string[];
}

export const DEFAULT_FALLBACK_MODELS: readonly FallbackModelConfig[] = [
  {
    modelId: 'anthropic/claude-sonnet-4.6',
    displayName: 'Anthropic: Claude Sonnet 4.6',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'anthropic/claude-opus-4.7',
    displayName: 'Anthropic: Claude Opus 4.7',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'google/gemini-3-flash-preview',
    displayName: 'Google: Gemini 3 Flash Preview',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file', 'audio', 'video'],
  },
  {
    modelId: 'google/gemini-3.1-pro-preview',
    displayName: 'Google: Gemini 3.1 Pro Preview',
    toolsSupported: true,
    inputModalities: ['audio', 'file', 'image', 'text', 'video'],
  },
  {
    modelId: 'openai/gpt-5.4',
    displayName: 'OpenAI: GPT-5.4',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'openai/gpt-5.5',
    displayName: 'OpenAI: GPT-5.5',
    toolsSupported: true,
    inputModalities: ['file', 'image', 'text'],
  },
] as const;

export const DEFAULT_FALLBACK_MODEL_ID = 'anthropic/claude-sonnet-4.6';

export const SLIDING_SYNC_AI_ROOM_LIST_NAME = 'ai-room';
export const SLIDING_SYNC_AUTH_ROOM_LIST_NAME = 'auth-room';
export const SLIDING_SYNC_LIST_RANGE_END = 9;
// Sliding-sync per-room timeline_limit is sized differently per list, and the
// AI-room list also uses a two-stage value: small during the very first sync
// (cold-start latency), then bumped after the initial sync completes so live
// streaming bursts can't be dropped.
//
// INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT — the conservative value used for
// the AI-room list on the first /sync request and as the SlidingSync
// constructor's default for any list/subscription we haven't otherwise
// overridden. Keeping it at 1 keeps the initial sync fast when many AI rooms
// exist.
//
// SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT — the steady-state value applied to the
// AI-room list via setList() immediately after the first SlidingSyncState.Complete
// event. AI streaming responses are not one-event-per-message: the bot emits an
// initial m.room.message with isStreamingFinished:false, then many m.replace
// events (~250 ms throttle), then a final m.replace with isStreamingFinished:true.
// If more than one replace lands in the same sliding-sync poll window,
// timeline_limit=1 only delivers the latest; any event landing after the
// finalization replace in that same window displaces it, the host's tracked
// Message stays at isStreamingFinished:false, and the assistant panel hangs
// in "generating results" until a manual page reload. The higher steady-state
// value keeps the full streaming burst (and any trailing room churn) in each
// /sync response.
//
// SLIDING_SYNC_AUTH_ROOM_TIMELINE_LIMIT — realm session rooms (auth-room list)
// receive a burst of multiple events per write or delete (incremental-index-
// initiation → update → incremental, plus an extra initiation per file in
// multi-file batches). The `update` event sits in the middle of that burst and
// is what DirectoryResource subscribes to for live file-tree refresh; without
// the higher limit it gets silently dropped from the live Room.timeline.
export const INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT = 1;
export const SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT = 20;
export const SLIDING_SYNC_AUTH_ROOM_TIMELINE_LIMIT = 20;
export const SLIDING_SYNC_TIMEOUT = 30000;
