export const APP_BOXEL_STOP_GENERATING_EVENT_TYPE = 'app.boxel.stopGenerating';
export const APP_BOXEL_MESSAGE_MSGTYPE = 'app.boxel.message';
export const APP_BOXEL_CARD_FORMAT = 'app.boxel.card';

// Leads the source URL of a file attached to a message that is not in any
// workspace: one the user attached from their computer, or an image a tool
// captured. Its content is uploaded from the bytes the host holds, never
// fetched from its source URL.
export const LOCAL_SOURCE_URL_PREFIX = 'boxel-local://';
// Leads the source URL of an image a tool captured for the model, such as one
// `realm.capture` took in a run-realm-code script. The capture is a picture of
// a render, not a file in a workspace.
export const CAPTURE_SOURCE_URL_PREFIX = `${LOCAL_SOURCE_URL_PREFIX}capture/`;

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

// An event's latest content. Room history fetched without edits keeps a
// streamed bot message's placeholder content; the server carries the latest
// edit, whose content holds the final body and tool requests, under
// `unsigned['m.relations']['m.replace']`. ai-bot's edits carry their full
// content at the top level, which is what this reads.
export function latestEventContent(event: {
  content?: Record<string, any>;
  unsigned?: Record<string, any>;
}): Record<string, any> | undefined {
  return (
    event.unsigned?.['m.relations']?.['m.replace']?.content ?? event.content
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
// The most JSON-encoded content a Matrix event should carry. Synapse refuses
// an event over 65,536 bytes (M_TOO_LARGE), and that limit counts the whole
// event, so the content budget leaves room for the envelope.
export const MAX_MATRIX_EVENT_CONTENT_BYTES = 56 * 1024;
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE =
  'app.boxel.codePatchCorrectness';
export const APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE =
  'app.boxel.codePatchCorrectnessAnnotation';
export const APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE = 'app.boxel.debug';
// Posted by ai-bot when a room's prompt outgrows the model's context window.
// It carries a summary of the history up to and including `upToEventId`; the
// prompt uses the summary in place of that history from then on.
export const APP_BOXEL_COMPACTION_EVENT_TYPE = 'app.boxel.compaction';
export const APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE =
  'app.boxel.realm-server-event';
// `eventType` carried inside a realm-server-event body (see send-event.ts /
// RealmServerService.handleEvent). Signals that the set of realms the user can
// access changed server-side (a realm was created, deleted, archived, or
// unarchived), so a session viewing the workspace chooser should re-derive its
// list. Deliberately a bare signal — the host re-fetches authoritatively rather
// than trusting any payload.
export const REALMS_LIST_UPDATED_EVENT_TYPE = 'realms-list-updated';
export const APP_BOXEL_ROOM_SKILLS_EVENT_TYPE = 'app.boxel.room.skills';
export const APP_BOXEL_REALMS_EVENT_TYPE = 'app.boxel.realms';
export const APP_BOXEL_REALM_SERVERS_EVENT_TYPE = 'app.boxel.realm-servers';

export interface AppBoxelRealmServersContent {
  realmServers: string[];
}
export const APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE =
  'app.boxel.workspace-favorites';
// The public realms a user has added to the Catalogs section of their
// dashboard, alongside the operator-chosen catalogs every user sees.
export const APP_BOXEL_CATALOG_REALMS_EVENT_TYPE = 'app.boxel.catalog-realms';
// The user's own dashboard state: onboarding and agent setup progress. Its
// shape is in dashboard-state.ts.
export const APP_BOXEL_DASHBOARD_EVENT_TYPE = 'app.boxel.dashboard';
export const APP_BOXEL_SYSTEM_CARD_EVENT_TYPE = 'app.boxel.system-card';
export const APP_BOXEL_REALM_EVENT_TYPE = 'app.boxel.realm-event';
// The room type of the room a private realm sends its realm events into. Its
// members are the users the realm's grants name, so one copy of each event
// reaches all of them, in place of a copy in each one's session room.
export const APP_BOXEL_REALM_EVENT_ROOM_TYPE = 'app.boxel.realm-events';
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
  // Same wire shape as APP_BOXEL_TOOL_REQUESTS_KEY on the room event: ai-bot
  // runs previews through the same normalization, so each request is
  // `{ id, name, arguments: <object> }`. `arguments` is `{}` while the tool
  // call's JSON is still incomplete mid-stream; `argumentsText` then carries
  // the raw text received so far, for display only.
  toolRequests: unknown[];
}

// Device id (from matrixClient.getDeviceId()) of the client that composed a
// user-prompt event, stamped so ai-bot knows which device to target with
// app.boxel.response-stream to-device previews for that turn.
export const APP_BOXEL_ORIGINATING_DEVICE_ID_KEY =
  'app.boxel.originating-device-id';

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
    modelId: 'anthropic/claude-opus-5.5',
    displayName: 'Anthropic: Claude Opus 5.5',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'anthropic/claude-sonnet-5.5',
    displayName: 'Anthropic: Claude Sonnet 5.5',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'anthropic/claude-haiku-5.5',
    displayName: 'Anthropic: Claude Haiku 5.5',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'anthropic/claude-sonnet-4.6',
    displayName: 'Anthropic: Claude Sonnet 4.6',
    toolsSupported: true,
    inputModalities: ['text', 'image', 'file'],
  },
  {
    modelId: 'openai/gpt-6-luna',
    displayName: 'OpenAI: GPT-6 Luna',
    toolsSupported: true,
    inputModalities: ['file', 'image', 'text'],
  },
  {
    modelId: 'openai/gpt-5.6-sol',
    displayName: 'OpenAI: GPT-5.6 Sol',
    toolsSupported: true,
    inputModalities: ['file', 'image', 'text'],
  },
] as const;

export const DEFAULT_FALLBACK_MODEL_ID = 'anthropic/claude-haiku-5.5';

export const SLIDING_SYNC_AI_ROOM_LIST_NAME = 'ai-room';
export const SLIDING_SYNC_AUTH_ROOM_LIST_NAME = 'auth-room';
export const SLIDING_SYNC_REALM_EVENT_ROOM_LIST_NAME = 'realm-event-room';
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
// the higher limit it gets silently dropped from the live Room.timeline. The
// rooms of private realms (realm-event-room list) receive the same bursts, so
// they use the same limit.
export const INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT = 1;
// The ai-bot's room list window. Sliding sync reports changes only for rooms
// inside the requested range, and matrix-js-sdk does not backfill a `limited`
// timeline, so a one-room window (`[[0, 0]]`) makes the bot see only the newest
// event of the newest room per sync response: when two rooms change in the
// same gap between two responses, the other room's event is lost, and the
// turn it belonged to hangs until someone posts in that room again. With a
// hundred-room window and SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT events per room
// a drop needs more than a hundred rooms changing inside one gap.
export const SLIDING_SYNC_AI_BOT_ROOM_LIST_RANGE: [number, number] = [0, 99];
export const SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT = 20;
export const SLIDING_SYNC_AUTH_ROOM_TIMELINE_LIMIT = 20;
// Sliding sync orders a list by recent activity and reports changes only for
// rooms inside its range. A host is in the event room of every private realm
// it has opened that still names it, which can be more rooms than this
// window, but a room moves back into the window as soon as it gets an event.
export const SLIDING_SYNC_REALM_EVENT_ROOM_LIST_RANGE: [number, number] = [
  0, 99,
];
export const SLIDING_SYNC_TIMEOUT = 30000;
