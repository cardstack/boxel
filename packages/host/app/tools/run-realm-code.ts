import { service } from '@ember/service';

import { cloneDeep, mergeWith } from 'lodash-es';

import {
  assertQuery,
  clearReplacedArrayFieldMeta,
  coerceErrorMessage,
  ensureTrailingSlash,
  isAbsoluteIdentifier,
  isBinaryContentType,
  isCardInstance,
  isFileDefInstance,
  isPrefixForm,
  isRelativePath,
  isResolvedCodeRef,
  logger,
  RealmPaths,
  resolveRRIReference,
  resourceIdentity,
  ri,
  rri,
  searchEntryWireQueryFromQuery,
  SupportedMimeType,
  validateWriteSize,
  type CapabilityAnswer,
  type CapabilityCheck,
  type CardResource,
  type EntryCollectionDocument,
  type Format,
  type LooseSingleCardDocument,
  type Query,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type Relationship,
  type Saved,
  type SearchEntryWireQuery,
  type BaseOperation,
  type OperationWriteResult,
} from '@cardstack/runtime-common';
import {
  realmsOfDisabledFeatures,
  sessionSkillFeatures,
} from '@cardstack/runtime-common/ai/debug';
import { isWrite } from '@cardstack/runtime-common/card-operations';
import { LOCAL_SOURCE_URL_PREFIX } from '@cardstack/runtime-common/matrix-constants';

import {
  BATCH_MEMBER,
  assertInstanceOperation,
  assertPayloadSuppliesParams,
  type OperationsBucket,
} from '../lib/card-operation-invocation';
import {
  recordCatalogSearch,
  type CatalogSearch,
} from '../lib/catalog-search-telemetry';
import {
  generateImage,
  IMAGE_EXTENSION_RE,
  IMAGE_FILE_EXTENSIONS,
  imageExtension,
  sourceImageDataUrl,
  type GeneratedImage,
} from '../lib/generate-image';
import HostBaseTool, {
  type ClickReason,
  type ResultAttachment,
} from '../lib/host-base-tool';
import {
  autoFixable,
  checkFix,
  MAX_AUTO_FIX_ATTEMPTS,
  MAX_AUTO_FIX_CODE_CHARS,
  proposeFix,
} from '../lib/realm-runner/auto-fix';
import { RealmCaptures, type CaptureURL } from '../lib/realm-runner/captures';
import { roomCredits, type RoomCredits } from '../lib/realm-runner/credits';
import {
  compactDiff,
  CARD_CHANGES_IN_DETAIL,
  cardChanges,
  type CardFieldChange,
  type RealmFileEdit,
} from '../lib/realm-runner/edits';
import {
  DEFAULT_WEB_SEARCH_LLM,
  jsonBytes,
  resolve as resolveJSON,
  resolveRequest,
  webRead,
  webReadRequest,
  webSearch,
  webSearchRequest,
  type ProxySend,
  type ResolveRequest,
  type ResolveResult,
  type WebReadRequest,
  type WebReadResult,
  type WebSearchRequest,
  type WebSearchResult,
} from '../lib/realm-runner/research';
import {
  RoomActions,
  type RequestedRoomChanges,
} from '../lib/realm-runner/room-actions';
import runRealmCode, {
  DeadlineExtension,
  RealmScriptError,
} from '../lib/realm-runner/runner';
import {
  RealmTransformer,
  transformRequest,
} from '../lib/realm-runner/transform';
import { STOPPED_BY_USER } from '../lib/realm-runner/types';
import { canonicalRealmIdentifier } from '../lib/realm-utils';
import { loadSkillSource } from '../lib/skill-tools';
import {
  captureDeadline,
  captureForAgent,
  resolveViewTarget,
  workspaceOf,
  uploadedImages,
  type ViewedImage,
  type ViewOptions,
} from '../lib/visual-capture';
import { createWorkspace, deleteWorkspace } from '../lib/workspaces';
import { pruneEmptyQueryParts } from '../utils/search/prune-empty-query';

import LintAndFixTool from './lint-and-fix';
import OpenWorkspaceTool from './open-workspace';
import PreviewFormatTool from './preview-format';
import {
  composeSearchEntriesQuery,
  resolveSearchEntryScope,
  searchEntrySummaries,
  type EntrySummary,
  type SearchEntriesFn,
} from './search-entries';
import SetActiveLLMTool from './set-active-llm';
import ShowCardTool from './show-card';
import ShowFileTool from './show-file';
import SwitchSubmodeTool from './switch-submode';
import UpdateRoomSkillsTool from './update-room-skills';

import type {
  RealmRunnerCallMethod,
  RealmScriptErrorInfo,
} from '../lib/realm-runner/types';

import type {
  default as BillingService,
  SubscriptionData,
} from '../services/billing-service';
import type CapabilitiesService from '../services/capabilities';
import type CardService from '../services/card-service';
import type ClientTelemetryService from '../services/client-telemetry';
import type EnvironmentService from '../services/environment-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type Base64ImageFieldType from '@cardstack/base/base64-image';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';
import type * as OperationsModule from '@cardstack/base/operations';

const log = logger('tools:run-realm-code');

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
// realm.cards.update has its own limit: a script that edits every card a
// search found must not stop at MAX_FILES. The updates are saved in one
// request when the script finishes, not one save each.
const MAX_CARD_UPDATES = 200;
// realm.operations calls in one run, each entry of a batch counted on its
// own, so a bulk change can reach as many cards as cards.update can.
const MAX_OPERATIONS = 200;
// Operations realm.operations.capabilities asks about in one run, each check
// counted on its own. Each check reads index rows on the realm.
const MAX_CAPABILITY_CHECKS = 500;
const MAX_FILE_SIZE = 500_000;
// A UTF-8 character is at most 4 bytes, so a larger body is always too large.
const MAX_READ_BYTES = MAX_FILE_SIZE * 4;
// A script that loops by mistake must not fill the user's workspace list.
const MAX_WORKSPACES = 5;
// realm.fs.writeBytes limits, in decoded bytes. These are the limits that
// apply: the 8 MB sandbox memory alone lets a script pass about twice the
// per-file size.
const MAX_BINARY_FILE_SIZE = 2_000_000;
const MAX_BINARY_BYTES_PER_RUN = 5_000_000;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_PREFIX_RE = /^data:[^,]*;base64,/i;
// realm.fs.download limits. The bytes go from the host to the realm and never
// into the sandbox, so they are wider than the writeBytes limits.
const MAX_DOWNLOAD_FILE_SIZE = 10_000_000;
const MAX_DOWNLOAD_BYTES_PER_RUN = 25_000_000;
// One download may take this long. It counts toward the run's own time limit
// too, so a slow download cannot hold the run past that.
const DOWNLOAD_TIMEOUT_MS = 20_000;
// The last part of a path, when it has a file extension.
const FILE_EXTENSION_RE = /\.[A-Za-z0-9]+$/;
// How many cards one `realm.cards.search` answers with when the query names no
// page size, and the most it answers with whatever the query asks for.
const DEFAULT_SEARCH_RESULTS = 50;
const MAX_SEARCH_RESULTS = 100;
// A search's answer is parsed inside the sandbox, within its memory limit, so
// it is bounded by size as well as by count. A page past this size is refused
// with the page size that fits, rather than cut: a cut page's remaining cards
// would be out of reach of every page number.
const MAX_SEARCH_RESULT_SIZE = 1_000_000;
// How many entries one `realm.entries.search` answers with when the options
// name no limit, and the most it answers with whatever they ask for. A script
// does not put each answer into the model's context, so these are wider than
// the search-entries tool's.
const DEFAULT_ENTRY_RESULTS = 20;
const MAX_ENTRY_RESULTS = 50;
// An answer is parsed inside the sandbox, within its memory limit, and each
// entry carries its full readMe, so it is bounded by size as well as count.
const MAX_ENTRY_RESULT_SIZE = 1_000_000;
// Host calls run inside this budget, and each write lints and saves before it
// returns, so it is much wider than a pure-CPU limit would need to be.
const RUN_TIMEOUT_MS = 55_000;
// One deadline for the whole call: sandbox start, the script, and the write
// in flight when it ends. It is under the tool service's 120 s execute
// timeout, so this tool always reports first, with every file it saved, and
// nothing is saved after that report.
const CALL_DEADLINE_MS = 100_000;
// realm.images.generate limits. Each image spends the user's credit, so a
// loop must not make many. One image takes 10-30 s, so image requests get
// their own time budget: a run that names the call gets it on top of the
// run's own limit, the call deadline and the tool service's execute timeout.
const MAX_IMAGES = 4;
const IMAGE_TIMEOUT_MS = 60_000;
const IMAGE_TIME_BUDGET_MS = 120_000;
// realm.web.search, realm.web.read and realm.resolve limits. They only read,
// so they need no click, but each one is a paid request through the realm
// server's proxy, and its answer is parsed inside the sandbox.
const MAX_WEB_CALLS = 20;
const MAX_RESOLVE_CALLS = 3;
// The bytes of JSON these calls hand the sandbox in one run. A read keeps at
// most 64k characters of markdown, so this is about twenty full pages.
const MAX_RESEARCH_BYTES_PER_RUN = 1_500_000;
// One call may take this long. It counts toward the run's own time limit too.
const RESEARCH_TIMEOUT_MS = 30_000;
// They run beside the run's other calls, a few at a time, so a script can read
// several pages at once.
const MAX_PARALLEL_RESEARCH = 4;
// A run that names one of these calls gets this much more time, as a run that
// names realm.images.generate does: a few pages read one after another
// outlast the usual limit.
const RESEARCH_TIME_MS = 60_000;
// realm.activity limits. A step past the limit is not recorded, and the
// script goes on.
const MAX_ACTIVITIES = 50;
const MAX_ACTIVITY_MESSAGE_CHARS = 200;
// realm.plan: the steps a script names before it takes them
const MAX_PLAN_STEPS = 12;
const MAX_PLAN_STEP_CHARS = 80;
// How long the auto-fix model call may take, within the call's deadline.
const AUTO_FIX_TIMEOUT_MS = 20_000;
// A stopped run answers within this long, whatever its sandbox or its calls
// in flight are still doing: one that ignores its signal must not hold the
// reader's Stop (and the composer's "Stopping…") open for good.
const STOP_GRACE_MS = 3_000;
const RESEARCH_CALL_RE = /realm\.(?:web\.(?:search|read)|resolve)\b/;
const RESEARCH_METHODS = new Set<RealmRunnerCallMethod>([
  'web.search',
  'web.read',
  'resolve',
]);

// The run's research requests. Each goes through the realm server's proxy,
// which holds the credentials.
interface Research {
  search(
    request: WebSearchRequest,
    signal: AbortSignal,
  ): Promise<{ results: WebSearchResult[]; model: string }>;
  read(
    request: WebReadRequest,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<WebReadResult>;
  resolve(request: ResolveRequest, signal: AbortSignal): Promise<ResolveResult>;
}
// A file as the realm serves it. `content` is empty unless the file is UTF-8
// text; `tooLarge` marks a text file whose body was not read.
type ReadSource = (url: string) => Promise<{
  status: number;
  content: string;
  binary: boolean;
  tooLarge?: boolean;
}>;
// Saves one file and returns the content that was saved (lint may reformat
// it, unless `lint` is false). `expected` is the content the script last saw,
// undefined for a file that did not exist; the save refuses if the realm no
// longer matches it.
type WriteFile = (
  url: string,
  content: string,
  expected: string | undefined,
  options?: { lint?: boolean },
) => Promise<string | undefined>;

// Saves the card instances realm.cards.update changed, all or none, in one
// request. `expected` is each file's content when the run first read it; the
// save refuses if the realm no longer matches it.
type SaveCards = (
  updates: { url: string; content: string; expected: string }[],
) => Promise<void>;

// Saves one binary file that did not exist.
type WriteBinaryFile = (url: string, bytes: Uint8Array) => Promise<void>;

// Deletes one file. `expected` is the text the run last read from it or saved
// to it, or the SHA-256 of the bytes it saved to a binary file; the delete
// refuses if the realm no longer matches it. It is undefined for a binary
// file that existed before the run, whose bytes the run never read.
type DeleteFile = (
  url: string,
  expected: { content: string } | { sha256: string } | undefined,
) => Promise<void>;

// Asks the image model for one image. `sourceImageUrl` is a data URL or the
// full URL of a file in this run's realm. `signal` stops both the source
// fetch and the image request.
type GenerateImage = (input: {
  prompt: string;
  sourceImageUrl?: string;
  llmModel?: string;
  signal: AbortSignal;
}) => Promise<GeneratedImage>;

// Fetches the bytes at a URL, at most `maxBytes` of them, or stops when
// `signal` aborts.
type DownloadFile = (
  sourceUrl: string,
  maxBytes: number,
  signal: AbortSignal,
) => Promise<Uint8Array>;

// What a DownloadFile throws for a body larger than `maxBytes`.
class DownloadTooLarge extends Error {}

// What `lookup` finds for a file that is not UTF-8 text.
const BINARY = Symbol('binary');

type DirectoryEntry = { name: string; kind: 'file' | 'directory' };

const MAX_UI_ACTIONS = 10;
const PREVIEW_FORMATS: Format[] = [
  'isolated',
  'embedded',
  'fitted',
  'atom',
  'edit',
];

// A `realm.ui` call the script made. The sandbox has no access to the UI, so
// the call only records what to do; the host does each action, in order,
// once the script has finished.
type UiAction =
  | { action: 'switchSubmode'; submode: 'interact' | 'code' }
  | { action: 'openFile'; url: string }
  | {
      action: 'previewFormat';
      cardId: string;
      modulePath: string;
      format: Format;
    }
  | { action: 'openWorkspace' };

// Reads one card instance as JSON data, computed fields included, with every
// URL in it absolute, or says why there is none to read.
type ReadCard = (id: string) => Promise<CardRead>;

// What reading a card found. A card whose file the realm holds without an
// index row is `indexing` while the realm is indexing, since the pass that is
// running may add the row, and `unindexed` while it is not, since no pass is
// coming to add it. `error` is a card whose index row records an error;
// `unreadable` is a read that failed for any other reason. `not-a-card` is a
// path that names a file, such as an image, rather than a card instance.
type CardRead =
  | { doc: LooseSingleCardDocument }
  | { unread: 'indexing' | 'unindexed' | 'not-found' | 'not-a-card' }
  | { unread: 'error' | 'unreadable'; message: string };

// One operation a card's type declares, named by the card it acts on.
interface OperationEntry {
  cardId: string;
  operation: string;
  payload: Record<string, unknown> | undefined;
}

// What the realm answered for one operation: a write names the card it wrote
// and the version that card now holds, a read answers the document, and a
// delete answers nothing.
interface OperationAnswer {
  id?: string;
  version?: string;
  indexPending?: boolean;
  document?: Record<string, unknown>;
}

// Sends operations on cards of a realm in one `_operations` request, which
// the realm carries out whole or not at all, and answers each in the order it
// was given.
type RunOperations = (entries: OperationEntry[]) => Promise<OperationAnswer[]>;

// Asks the run's realm whether it would allow each operation now, and answers
// in the order asked. Runs none of them.
type CheckCapabilities = (
  checks: CapabilityCheck[],
) => Promise<CapabilityAnswer[]>;

// What a realm.operations.capabilities check asks about: a card, by its
// path, or a type, by its code ref.
type CapabilityQuestion =
  | { path: string; operation: string }
  | { type: { module: string; name: string }; operation: string };

// One check as the script reads it back: its question and the realm's answer.
type CapabilityResult = CapabilityQuestion &
  Pick<CapabilityAnswer, 'allowed' | 'conditional' | 'reason'>;

const CAPABILITY_CHECK_SHAPE =
  '{ path, operation } for a card, or { type: { module, name }, operation } for a type';

// Lists one directory. `entries` is empty unless `status` is 200.
type ListDirectory = (
  url: string,
) => Promise<{ status: number; entries: DirectoryEntry[] }>;

// Creates a workspace owned by the current user and returns its URL and name.
type CreateWorkspace = (input: {
  name?: string;
  endpoint?: string;
}) => Promise<{ url: string; name: string }>;

// Deletes a workspace the current user administers and returns its URL.
type DeleteWorkspace = (realmIdentifier: string) => Promise<{ url: string }>;

// The index of the run's realm. Every call acts on the whole realm or on
// paths already resolved inside it.
interface IndexActions {
  invalidate(urls: string[]): Promise<void>;
  reindex(): Promise<void>;
  fullReindex(): Promise<void>;
  cancelJob(): Promise<void>;
}

const MAX_INVALIDATE_PATHS = 100;
// The index calls a run may make. Each call starts an index job on the realm
// server, so a loop must not start many. A reindex or a full reindex covers
// the whole realm, so a second one in the same run does no more work; a full
// reindex is the most costly of them.
const MAX_INDEX_CALLS = {
  'index.invalidate': 10,
  'index.reindex': 1,
  'index.fullReindex': 1,
} as const;
type LimitedIndexCall = keyof typeof MAX_INDEX_CALLS;

// Calls that cannot be undone, that spend the user's credit, that change
// the state of a whole realm for a long time, or that fetch any URL with the
// user's realm credentials (realm.fs.download). A script that may make one
// names the call in its code. Such a run always waits for the user's click
// (`neverAutoExecutesFor`), and only such a run may make the call: a script
// that reaches it another way is refused, so none of them runs without a
// click. Each call has the reason the approval panel shows the user for it,
// so the panel and the click rule read the same list.
const CLICK_REQUIRED_CALLS = {
  'realm.workspaces.delete': 'Deletes a workspace. This cannot be undone.',
  'realm.fs.delete': 'Deletes a file. This cannot be undone.',
  'realm.images.generate': 'Generates images, which uses your credit.',
  'realm.index.fullReindex':
    'Indexes the whole workspace again from the start, which can take a long time.',
  'realm.index.cancelJob': "Cancels the workspace's running index job.",
  'realm.fs.download':
    'Downloads a file from an outside URL into the workspace.',
} as const;
type ClickRequiredCall = keyof typeof CLICK_REQUIRED_CALLS;

// The click-required calls a script names in its code.
export function clickRequiredCallsIn(code: unknown): Set<ClickRequiredCall> {
  return new Set(
    typeof code === 'string'
      ? (Object.keys(CLICK_REQUIRED_CALLS) as ClickRequiredCall[]).filter(
          (name) => code.includes(name),
        )
      : [],
  );
}

function notNamedError(name: ClickRequiredCall) {
  return new Error(
    `${name} must be called by that name in the script, so the user confirms the run before it starts`,
  );
}

// Calls that need write access to the run's workspace. A Record over every
// method, so a new method does not type-check until it is listed here. The
// workspace calls act on other workspaces and keep their own checks.
const REQUIRES_WRITE: Record<RealmRunnerCallMethod, boolean> = {
  'fs.readText': false,
  'fs.exists': false,
  'fs.list': false,
  'fs.replace': true,
  'fs.writeText': true,
  'fs.copy': true,
  'fs.writeBytes': true,
  'fs.download': true,
  'cards.search': false,
  'cards.get': false,
  'cards.update': true,
  // An operation is authorized by the realm's policy for the operation, not
  // by write access to the workspace, so it can run where the user can only
  // read. The realm refuses one the policy does not allow.
  'operations.invoke': false,
  'operations.invokeBatchOperation': false,
  // Asking runs nothing, and the realm answers a caller who can only read.
  'operations.capabilities': false,
  'entries.search': false,
  'fs.delete': true,
  capture: false,
  'images.generate': true,
  'workspaces.create': false,
  'workspaces.delete': false,
  'room.enableSkills': false,
  'room.disableSkills': false,
  'room.setModel': false,
  'room.credits': false,
  'ui.switchSubmode': false,
  'ui.openFile': false,
  'ui.previewFormat': false,
  'ui.openWorkspace': false,
  'index.invalidate': true,
  'index.reindex': true,
  'index.fullReindex': true,
  'index.cancelJob': true,
  'web.search': false,
  'web.read': false,
  resolve: false,
  transform: false,
  activity: false,
  plan: false,
  ask: false,
};

// Runs one search in the run's realm and answers with the entry document.
type SearchCards = (
  query: SearchEntryWireQuery,
) => Promise<EntryCollectionDocument>;

// Resolves a reference — a URL, a realm's prefix-form identifier, or a path
// relative to `base` — to a URL.
type ResolveURL = (reference: string, base?: string) => string;

// Told about each realm.entries.search that was sent: what it asked for, the
// realms it was sent to, and what it found or the error it ended with. A
// query refused before it is sent is not reported.
type RecordEntriesSearch = (
  search: Pick<CatalogSearch, 'query' | 'realms' | 'found' | 'error'>,
) => void;

// One card a search found, as plain data. `id` is the card's URL and `path`
// its file relative to the realm root, which `realm.fs` takes. The type and
// links are full URLs, so a type can go back into a query's `on` or `type`.
// The data is the index's: attributes carry computed values too, so it is not
// the file's text. `relationships` is keyed by field path as the card's own
// document keys it, so a `linksToMany` field's links are `field.0`,
// `field.1`, and so on. A search never matches a card that failed to index.
interface FoundCard {
  id: string;
  path: string;
  type?: { module: string; name: string };
  attributes: Record<string, unknown>;
  relationships: Record<string, string | null>;
}

// The host half of `realm.fs`: every call the script makes lands here, inside
// one realm. `room.*` calls land here too, so they share the run's queue and
// its end. Reads come from the realm on first use. A write saves the file
// before the call returns, so a script that awaits each write sees each file
// land in the realm as it goes.
// Where a run is, as `realm.activity({ current, total, message, count, of })`
// reported it, and the steps `realm.plan([...])` named ahead of it.
export interface RealmRunnerProgress {
  step: number;
  of: number;
  label: string;
  // the steps the script means to take, in order
  plan?: string[];
  // how far through the current step: `count` of `countOf`
  count?: number;
  countOf?: number;
}

class RealmFsSession {
  // url -> content as the realm now holds it, as far as this run knows;
  // undefined means the file does not exist.
  private known = new Map<string, string | undefined>();
  // Files saved by this run, in the order of their first save. A file the
  // run deleted is no longer here.
  readonly saved = new Set<string>();
  // Files the run wrote that came out of lint with the text they already
  // held (lint removes unused imports), and that it never changed. Nothing
  // was written, and the result says so rather than reporting them saved.
  readonly unchanged = new Set<string>();
  // Files this run created that still exist, so a delete is reported as
  // undoing the run's own write rather than removing an earlier file.
  private created = new Set<string>();
  // Files this run created and then deleted, in the order of their delete.
  readonly deleted = new Set<string>();
  // Card instances realm.cards.update changed, keyed by file URL, in the
  // order of their first update. None is saved until the script finishes.
  private cardUpdates = new Map<
    string,
    { expected: string; doc: LooseSingleCardDocument }
  >();
  // Files that existed before this run and that realm.fs.delete deleted, in
  // the order of their delete.
  readonly deletedExisting = new Set<string>();
  // Workspaces created by this run, in order.
  readonly createdWorkspaces: string[] = [];
  // Workspaces deleted by this run, in order.
  readonly deletedWorkspaces: string[] = [];
  // Workspaces this run deleted that do not exist again: a later create at
  // the same URL takes the URL out.
  readonly goneWorkspaces = new Set<string>();
  // `realm.index` calls this run made, in order. The realm server has started
  // each one, so a retry must not start it again.
  readonly indexActions: string[] = [];
  // Operations the realm carried out for this run, in order, as
  // "<operation> on <path>". They cannot be undone, so a failed run names them
  // and a retry does not run them again.
  readonly operationsRun: string[] = [];
  private operationCount = 0;
  private capabilityCheckCount = 0;
  // Binary files this run knows exist: found by a lookup or saved by
  // realm.fs.writeBytes. They are not in `known`, since their content is not
  // text, but they count toward MAX_FILES.
  readonly binary = new Set<string>();
  // The SHA-256 of the bytes realm.fs.writeBytes saved, for each binary file
  // this run created, so a delete can tell the file is still the run's.
  private binaryDigests = new Map<string, string>();
  private binaryBytes = 0;
  // Images this run asked the model for, including ones that failed: each
  // request spends credit.
  private imagesRequested = 0;
  // Image request time this run has used, in ms, of IMAGE_TIME_BUDGET_MS.
  private imageTimeUsed = 0;
  private downloadedBytes = 0;
  private webCalls = 0;
  private reportedActivities = 0;
  private resolveCalls = 0;
  private indexCalls = Object.fromEntries(
    Object.keys(MAX_INDEX_CALLS).map((method) => [method, 0]),
  ) as Record<LimitedIndexCall, number>;
  private researchBytes = 0;
  private researchSlots = MAX_PARALLEL_RESEARCH;
  private researchWaiters: (() => void)[] = [];
  // Research calls and transforms run outside the queue: they touch no file,
  // so they cannot race one. `idle` still waits for them.
  private unqueuedInFlight = new Set<Promise<unknown>>();
  // Each file this run changed: its text before the first change and after
  // the last, in the order of the first change. The transcript shows them
  // as diffs and Undo puts them back.
  readonly edits = new Map<string, Omit<RealmFileEdit, 'url'>>();
  // The files the script read, and how much, for the row's quiet count.
  readonly readUrls = new Set<string>();
  bytesRead = 0;
  // Each fs.copy, as "from → to" paths, for the row's own line.
  readonly copies: string[] = [];
  // What the run's research calls did, one line each, in the order they
  // ended: what was searched or read, and the reason a call failed.
  readonly activity: string[] = [];
  // Asks the reader a question and waits for the pick (realm.ask). Set by
  // the tool for a run with a reader; a run without one is refused.
  ask?: (request: ScriptAsk) => Promise<{ answer: string; label: string }>;
  // Called as each line is recorded, so the host can show a run's steps
  // while it is still running rather than only in its result.
  onActivity?: (line: string, progress?: RealmRunnerProgress) => void;
  // What the run's searches found, each entry once, best match first. Called
  // after every search, so the row can show the matches while the run goes on.
  onFound?: (found: EntrySummary[]) => void;
  private found = new Map<string, EntrySummary>();
  // realm.* calls the script has made, realm.activity aside. A script that
  // fails before its first one did nothing, so it may be fixed and run again.
  callsMade = 0;
  // What `realm.capture` takes in this run.
  readonly captures: RealmCaptures;
  // What `realm.ui` asked for, in the order the script asked.
  readonly uiActions: UiAction[] = [];
  // Calls and saves refused because the run had already ended.
  private refused = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Aborted when the run ends, so a workspace create or an image request
  // still in flight stops holding up the report.
  private inFlight = new AbortController();
  // Runs realm.transform programs, in a worker started on the first one.
  private transformer = new RealmTransformer();
  // Set once the run has ended. A call that has not started yet is refused,
  // and a write still in flight is not saved, so nothing lands after the tool
  // has reported.
  private closed = false;

  constructor(
    private realmURL: string,
    private readSource: ReadSource,
    private writeFile: WriteFile,
    private saveCards: SaveCards,
    private writeBinaryFile: WriteBinaryFile,
    private deleteFile: DeleteFile,
    private downloadFile: DownloadFile,
    private listDirectory: ListDirectory,
    private search: SearchCards,
    private resolveURL: ResolveURL,
    private readCard: ReadCard,
    private runOperations: RunOperations,
    private searchEntries: SearchEntriesFn,
    // The realms a search of `realms` is sent to, none when the room's feature
    // gate keeps out every realm it would reach. Refuses a realm identifier
    // that names no realm the host knows.
    private resolveSearchRealms: (realms: string[] | undefined) => string[],
    captureURL: CaptureURL,
    // Whether a URL or card id is held by this realm itself rather than by
    // another workspace, including one nested under this realm's URL.
    private heldByThisRealm: (reference: string) => boolean,
    private createWorkspace: CreateWorkspace,
    private deleteWorkspace: DeleteWorkspace,
    private generateImage: GenerateImage,
    private namedCalls: Set<ClickRequiredCall>,
    private index: IndexActions,
    private mayWrite: boolean,
    // The most bytes a card file may hold, as the realm enforces it.
    private cardSizeLimitBytes: number,
    readonly room: RoomActions,
    private research: Research,
    private recordEntriesSearch: RecordEntriesSearch,
    private checkCapabilities: CheckCapabilities,
  ) {
    this.captures = new RealmCaptures(captureURL);
  }

  // Calls, saves and captures refused because the run had already ended.
  get refusedAfterClose() {
    return this.refused + this.captures.refusedAfterClose;
  }

  // Calls run one at a time, so two unawaited calls cannot race over the same
  // file.
  call(method: RealmRunnerCallMethod, args: unknown[]): Promise<unknown> {
    if (method === 'activity' || method === 'plan') {
      try {
        return Promise.resolve(
          method === 'plan'
            ? this.reportPlan(args[0])
            : this.reportActivity(args[0]),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    }
    this.callsMade += 1;
    if (RESEARCH_METHODS.has(method) || method === 'transform') {
      // Research and transforms touch no realm file, so they neither wait
      // behind file calls nor hold file calls up.
      let result =
        method === 'transform'
          ? Promise.resolve().then(() =>
              this.transformer.run(transformRequest(args[0], args[1], args[2])),
            )
          : this.researchCall(method, args);
      let tracked = result.catch(() => undefined);
      this.unqueuedInFlight.add(tracked);
      tracked.finally(() => this.unqueuedInFlight.delete(tracked));
      return result;
    }
    let result = this.queue.then(() => {
      if (this.closed) {
        this.refused += 1;
        throw new Error('The run has ended; this realm call was not made');
      }
      // The realm refuses the write anyway; this says why before any work.
      if (REQUIRES_WRITE[method] && !this.mayWrite) {
        throw new Error(
          `You can only read this workspace; realm.${method} was not run`,
        );
      }
      return this.dispatch(method, args);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  close() {
    this.closed = true;
    this.captures.close();
    this.transformer.close();
    this.inFlight.abort();
    // Calls waiting for a research slot wake and are refused.
    for (let wake of this.researchWaiters.splice(0)) {
      wake();
    }
  }

  // Settles once every call already made has finished or been refused.
  idle(): Promise<unknown> {
    return Promise.all([this.queue, ...this.unqueuedInFlight]);
  }

  // Settles once every queued call (each save and delete among them) has
  // finished or been refused. Research calls and transforms are not waited on.
  queueSettled(): Promise<unknown> {
    return this.queue;
  }

  // A step the script reports, such as `Step 2 of 4 · Gather sources`. It
  // changes nothing, so it needs no write access and runs at once.
  private reportActivity(raw: unknown) {
    if (this.closed) {
      throw new Error('The run has ended; this activity was not recorded');
    }
    let details = typeof raw === 'string' ? { message: raw } : raw;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      throw new TypeError(
        'realm.activity expects { operation?, phase?, message, current?, total?, count?, of? }',
      );
    }
    let { operation, phase, message, current, total, count, of } =
      details as Record<string, unknown>;
    let unknown = Object.keys(details).find(
      (key) =>
        ![
          'operation',
          'phase',
          'message',
          'current',
          'total',
          'count',
          'of',
        ].includes(key),
    );
    if (unknown) {
      throw new TypeError(`realm.activity does not take ${unknown}`);
    }
    if (
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > MAX_ACTIVITY_MESSAGE_CHARS
    ) {
      throw new TypeError(
        `realm.activity message must be 1 to ${MAX_ACTIVITY_MESSAGE_CHARS} characters`,
      );
    }
    for (let [key, value] of Object.entries({ operation, phase })) {
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'string' || value.length > 60)
      ) {
        throw new TypeError(
          `realm.activity ${key} must be a string of at most 60 characters`,
        );
      }
    }
    for (let [key, value] of Object.entries({ current, total, count, of })) {
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
      ) {
        throw new TypeError(
          `realm.activity ${key} must be a whole number of 0 or more`,
        );
      }
    }
    if (
      typeof current === 'number' &&
      typeof total === 'number' &&
      current > total
    ) {
      throw new TypeError('realm.activity current cannot be more than total');
    }
    if (typeof count === 'number' && typeof of === 'number' && count > of) {
      throw new TypeError('realm.activity count cannot be more than of');
    }
    if (this.reportedActivities >= MAX_ACTIVITIES) {
      return { recorded: false };
    }
    this.reportedActivities += 1;
    let step =
      typeof current === 'number'
        ? `Step ${current}${typeof total === 'number' ? ` of ${total}` : ''} · `
        : '';
    let label = [operation, phase].filter(Boolean).join(' · ');
    this.noteActivity(
      `${step}${message.trim()}${label ? ` (${label})` : ''}`,
      typeof current === 'number'
        ? {
            step: current,
            of: typeof total === 'number' ? total : current,
            label: message.trim(),
            ...(this.planSteps ? { plan: this.planSteps } : {}),
            ...(typeof count === 'number' && typeof of === 'number'
              ? { count, countOf: of }
              : {}),
          }
        : undefined,
    );
    return { recorded: true };
  }

  // The steps the script named with realm.plan, shown as a checklist that
  // realm.activity's `current` ticks through. A second call revises them.
  private planSteps: string[] | undefined;

  private reportPlan(raw: unknown) {
    if (this.closed) {
      throw new Error('The run has ended; this plan was not recorded');
    }
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      raw.length > MAX_PLAN_STEPS ||
      raw.some(
        (step) =>
          typeof step !== 'string' ||
          !step.trim() ||
          step.length > MAX_PLAN_STEP_CHARS,
      )
    ) {
      throw new TypeError(
        `realm.plan expects 1 to ${MAX_PLAN_STEPS} step names, each 1 to ${MAX_PLAN_STEP_CHARS} characters`,
      );
    }
    this.planSteps = (raw as string[]).map((step) => step.trim());
    this.noteActivity(`Plan · ${this.planSteps.join(' · ')}`, {
      step: 0,
      of: this.planSteps.length,
      label: '',
      plan: this.planSteps,
    });
    return { recorded: true };
  }

  private noteActivity(line: string, progress?: RealmRunnerProgress) {
    this.activity.push(line);
    this.onActivity?.(line, progress);
  }

  private async researchCall(
    method: RealmRunnerCallMethod,
    args: unknown[],
  ): Promise<unknown> {
    while (this.researchSlots === 0 && !this.closed) {
      await new Promise<void>((wake) => this.researchWaiters.push(wake));
    }
    if (this.closed) {
      this.refused += 1;
      throw new Error('The run has ended; this realm call was not made');
    }
    this.researchSlots -= 1;
    try {
      switch (method) {
        case 'web.search':
          return await this.webSearch(args[0], args[1]);
        case 'web.read':
          return await this.webRead(args[0], args[1]);
        case 'resolve':
          return await this.resolveData(args[0]);
        default:
          throw new Error(`Unknown realm call: ${String(method)}`);
      }
    } finally {
      this.researchSlots += 1;
      this.researchWaiters.shift()?.();
    }
  }

  private async webSearch(query: unknown, options: unknown) {
    let request = webSearchRequest(query, options);
    this.takeWebCall('realm.web.search');
    try {
      let { results, model } = await this.withResearchTimeout(
        'realm.web.search',
        (signal) => this.research.search(request, signal),
      );
      this.chargeResearch('realm.web.search', results);
      this.noteActivity(
        `Exa searched for "${request.query}" through ${model}: ${results.length} result${results.length === 1 ? '' : 's'}`,
      );
      return results;
    } catch (error) {
      this.noteActivity(
        `Exa search for "${request.query}" failed: ${coerceErrorMessage(error, 'unknown error')}`,
      );
      throw error;
    }
  }

  private async webRead(url: unknown, options: unknown) {
    let request = webReadRequest(url, options);
    let host = new URL(request.url).host;
    this.takeWebCall('realm.web.read');
    try {
      let page = await this.withResearchTimeout('realm.web.read', (signal) =>
        this.research.read(request, RESEARCH_TIMEOUT_MS, signal),
      );
      this.chargeResearch('realm.web.read', page);
      this.noteActivity(
        `Firecrawl read ${host}${page.metadata.statusCode && page.metadata.statusCode !== 200 ? ` (HTTP ${page.metadata.statusCode})` : ''}`,
      );
      return page;
    } catch (error) {
      this.noteActivity(
        `Firecrawl could not read ${host}: ${coerceErrorMessage(error, 'unknown error')}`,
      );
      throw error;
    }
  }

  // Runs an index call that counts toward its limit. The call is counted
  // before it starts, so calls made at the same time cannot pass the limit.
  // A call that fails did not start a job, so it gives its slot back and the
  // script can try again.
  private async runIndexCall(
    method: LimitedIndexCall,
    call: () => Promise<void>,
  ) {
    let max = MAX_INDEX_CALLS[method];
    if (this.indexCalls[method] >= max) {
      throw new Error(
        `Realm code may call realm.${method} at most ${max === 1 ? 'once' : `${max} times`} per run` +
          (method === 'index.invalidate'
            ? `; pass up to ${MAX_INVALIDATE_PATHS} paths in one call`
            : ''),
      );
    }
    this.indexCalls[method] += 1;
    try {
      await call();
    } catch (e) {
      this.indexCalls[method] -= 1;
      throw e;
    }
  }

  private async resolveData(raw: unknown) {
    // A refused request asks no model, so it does not count toward the
    // limit.
    let request = resolveRequest(raw);
    if (this.resolveCalls >= MAX_RESOLVE_CALLS) {
      throw new Error(
        `Realm code may call realm.resolve at most ${MAX_RESOLVE_CALLS} times per run`,
      );
    }
    this.resolveCalls += 1;
    try {
      let result = await this.withResearchTimeout('realm.resolve', (signal) =>
        this.research.resolve(request, signal),
      );
      this.chargeResearch('realm.resolve', result);
      this.noteActivity(
        `Resolved data with ${result.model}${request.webSearch ? ' and Exa search' : ''}`,
      );
      return result;
    } catch (error) {
      this.noteActivity(
        `realm.resolve failed: ${coerceErrorMessage(error, 'unknown error')}`,
      );
      throw error;
    }
  }

  private takeWebCall(name: string) {
    if (this.webCalls >= MAX_WEB_CALLS) {
      throw new Error(
        `Realm code may make at most ${MAX_WEB_CALLS} realm.web calls per run; ${name} was not made`,
      );
    }
    this.webCalls += 1;
  }

  // Charged once the answer is in, so an answer past the limit is refused
  // rather than handed to the sandbox.
  private chargeResearch(name: string, value: unknown) {
    let bytes = jsonBytes(value);
    this.researchBytes += bytes;
    if (this.researchBytes > MAX_RESEARCH_BYTES_PER_RUN) {
      throw new Error(
        `Research calls may return at most ${MAX_RESEARCH_BYTES_PER_RUN} bytes per run; the ${name} answer of ${bytes} bytes was dropped`,
      );
    }
  }

  // Runs one research request within RESEARCH_TIMEOUT_MS, and stops it when
  // the run ends.
  private async withResearchTimeout<T>(
    name: string,
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let stop = new AbortController();
    let timer = setTimeout(
      () =>
        stop.abort(
          new Error(`${name} took longer than ${RESEARCH_TIMEOUT_MS / 1000} s`),
        ),
      RESEARCH_TIMEOUT_MS,
    );
    let onRunEnd = () =>
      stop.abort(new Error(`The run has ended; ${name} was stopped`));
    this.inFlight.signal.addEventListener('abort', onRunEnd, { once: true });
    try {
      // A request that ignores the signal still ends the call when it aborts.
      return await new Promise<T>((resolvePromise, reject) => {
        stop.signal.addEventListener(
          'abort',
          () => reject(stop.signal.reason),
          { once: true },
        );
        request(stop.signal).then(resolvePromise, reject);
      });
    } finally {
      clearTimeout(timer);
      this.inFlight.signal.removeEventListener('abort', onRunEnd);
    }
  }

  private async dispatch(
    method: RealmRunnerCallMethod,
    args: unknown[],
  ): Promise<unknown> {
    switch (method) {
      case 'fs.readText': {
        let url = this.resolve(method, args[0]);
        let content = await this.load(url);
        if (content === undefined) {
          throw new Error(`File not found: ${url}`);
        }
        return content;
      }
      case 'fs.exists': {
        let url = this.resolve(method, args[0]);
        return (await this.lookup(url)) !== undefined;
      }
      // A listing reads no file content, so it does not count toward
      // MAX_FILES.
      case 'fs.list': {
        let url = this.resolveDirectory(args[0]);
        let listing = await this.listDirectory(url);
        if (listing.status === 404) {
          throw new Error(`Directory not found: ${url}`);
        }
        if (listing.status !== 200) {
          throw new Error(`Unable to list ${url}: ${listing.status}`);
        }
        let dir = this.relative(url);
        return listing.entries.map(({ name, kind }) => ({
          name,
          path: `${dir}${name}${kind === 'directory' ? '/' : ''}`,
          kind,
        }));
      }
      case 'fs.replace': {
        let url = this.resolve(method, args[0]);
        let [, search, replacement] = args;
        if (typeof search !== 'string' || typeof replacement !== 'string') {
          throw new TypeError(
            'realm.fs.replace expects a path, a search string and a replacement string',
          );
        }
        if (search.length === 0) {
          throw new Error(
            'realm.fs.replace requires a non-empty search string',
          );
        }
        let current = await this.load(url);
        if (current === undefined) {
          throw new Error(`File not found: ${url}`);
        }
        let first = current.indexOf(search);
        if (first < 0) {
          throw new Error(`Search string was not found in ${url}`);
        }
        if (current.indexOf(search, first + search.length) >= 0) {
          throw new Error(`Search string matched more than once in ${url}`);
        }
        await this.save(
          url,
          current.slice(0, first) +
            replacement +
            current.slice(first + search.length),
          current,
        );
        return { path: this.relative(url), matches: 1, saved: true };
      }
      case 'fs.writeText': {
        let url = this.resolve(method, args[0]);
        let content = args[1];
        if (typeof content !== 'string') {
          throw new TypeError(
            'realm.fs.writeText expects a path and a content string',
          );
        }
        // Only creates for now: an edit to an existing file always goes
        // through realm.fs.replace.
        if ((await this.lookup(url)) !== undefined) {
          throw new Error(
            `File already exists; use realm.fs.replace to edit it: ${url}`,
          );
        }
        await this.save(url, content, undefined);
        return { path: this.relative(url), saved: true };
      }
      // Copies the content as it is, the same as a readText then a writeText.
      // Relative imports and card references are not rewritten, so they stay
      // correct only in a copy at the same folder depth. The content is
      // already in the realm, so it is saved without lint, which could only
      // make the copy differ from its source.
      case 'fs.copy': {
        let from = this.resolve(method, args[0]);
        let to = this.resolve(method, args[1]);
        let content = await this.load(from);
        if (content === undefined) {
          throw new Error(`File not found: ${from}`);
        }
        if ((await this.lookup(to)) !== undefined) {
          throw new Error(`File already exists: ${to}`);
        }
        await this.save(to, content, undefined, { lint: false });
        let copied = this.edits.get(to);
        if (copied) {
          copied.copiedFrom = from;
        }
        this.copies.push(`${this.relative(from)} → ${this.relative(to)}`);
        return { path: this.relative(to), saved: true };
      }
      case 'fs.writeBytes': {
        let url = this.resolve(method, args[0]);
        // The limits are checked on the size the base64 decodes to, before
        // the decode allocates it.
        let base64 = cleanBase64(args[1]);
        let size = decodedSize(base64);
        if (size > MAX_BINARY_FILE_SIZE) {
          throw new Error(
            `realm.fs.writeBytes accepts at most ${MAX_BINARY_FILE_SIZE} bytes per file: ${url} is ${size} bytes`,
          );
        }
        if (this.binaryBytes + size > MAX_BINARY_BYTES_PER_RUN) {
          throw new Error(
            `realm.fs.writeBytes accepts at most ${MAX_BINARY_BYTES_PER_RUN} bytes per run`,
          );
        }
        // Only creates, the same as realm.fs.writeText.
        if ((await this.lookup(url)) !== undefined) {
          throw new Error(`File already exists: ${url}`);
        }
        if (this.closed) {
          this.refused += 1;
          throw new Error(`The run has ended; ${url} was not saved`);
        }
        let bytes = decodeBase64(base64);
        await this.writeBinaryFile(url, bytes);
        this.binaryBytes += bytes.byteLength;
        this.binaryDigests.set(url, await sha256(bytes));
        // The lookup above recorded the file as missing.
        this.known.delete(url);
        this.binary.add(url);
        this.markCreated(url);
        this.noteBinaryCreate(url);
        return {
          path: this.relative(url),
          size: bytes.byteLength,
          saved: true,
        };
      }
      // A search reads no file content, so it does not count toward
      // MAX_FILES.
      case 'cards.search':
        return await this.searchCards(args[0]);
      // A card is read as the indexed instance, not as its file, so it does
      // not count toward MAX_FILES and does not see this run's unsaved
      // state. Values cross into the sandbox only as JSON, so the script gets
      // the card serialized, as read-card-for-ai-assistant sends it to the
      // model, and not an instance.
      case 'cards.get': {
        let id = this.resolve(method, args[0]).replace(/\.json$/, '');
        let read = await this.readCard(id);
        if (!('doc' in read)) {
          throw new Error(this.cardReadError(id, read));
        }
        let { data } = read.doc;
        // The same shape as a card `realm.cards.search` finds: the type, and
        // each link keyed by its field path (`field.0`, `field.1`, … for a
        // `linksToMany` field). Every URL is already absolute.
        let adoptsFrom = data.meta.adoptsFrom;
        let relationships: Record<string, string | null> = {};
        for (let [field, value] of Object.entries(data.relationships ?? {})) {
          relationships[field] =
            (value as Relationship | null)?.links?.self ?? null;
        }
        return {
          id,
          path: `${this.relative(id)}.json`,
          ...(isResolvedCodeRef(adoptsFrom)
            ? { type: { module: adoptsFrom.module, name: adoptsFrom.name } }
            : {}),
          attributes: data.attributes ?? {},
          relationships,
        };
      }
      case 'cards.update':
        return await this.updateCard(args[0], args[1]);
      case 'operations.invoke': {
        let entry = this.operationEntry(method, args[0], args[1], args[2]);
        let [answer] = await this.runOperationEntries([entry]);
        return answer;
      }
      case 'operations.invokeBatchOperation': {
        let list = args[0];
        if (!Array.isArray(list) || list.length === 0) {
          throw new TypeError(
            'realm.operations.invokeBatchOperation expects a non-empty array of { path, operation, payload } entries',
          );
        }
        let entries = list.map((item: unknown) => {
          if (
            item === null ||
            typeof item !== 'object' ||
            Array.isArray(item)
          ) {
            throw new TypeError(
              'each realm.operations.invokeBatchOperation entry is { path, operation, payload }',
            );
          }
          let { path, operation, payload } = item as Record<string, unknown>;
          return this.operationEntry(method, path, operation, payload);
        });
        return await this.runOperationEntries(entries);
      }
      case 'entries.search':
        return await this.searchEntriesFor(args[0], args[1]);
      // Deletes a file, one this run created or one that was there before
      // the run. The run waits for the user's click, since the delete cannot
      // be undone.
      case 'fs.delete': {
        if (!this.namedCalls.has('realm.fs.delete')) {
          throw notNamedError('realm.fs.delete');
        }
        // A path that ends in `/` is refused here, so no folder is deleted.
        let url = this.resolve(method, args[0]);
        this.assertNoCardUpdate(url);
        // A text file is compared with what the run last read or saved, so
        // a file someone changed after the script read it is kept.
        let content = await this.lookup(url);
        if (content === undefined) {
          throw new Error(
            this.deleted.has(url) || this.deletedExisting.has(url)
              ? `File not found; this run already deleted it: ${url}`
              : `File not found: ${url}`,
          );
        }
        if (this.closed) {
          this.refused += 1;
          throw new Error(`The run has ended; ${url} was not deleted`);
        }
        let digest = this.binaryDigests.get(url);
        await this.deleteFile(
          url,
          content !== BINARY
            ? { content }
            : digest !== undefined
              ? { sha256: digest }
              : undefined,
        );
        let created = this.created.has(url);
        if (content !== BINARY) {
          this.noteEdit(url, content, undefined);
        } else if (created) {
          this.edits.delete(url);
        } else {
          this.edits.set(url, { irreversible: true });
        }
        this.forgetDeleted(url);
        (created ? this.deleted : this.deletedExisting).add(url);
        return { path: this.relative(url), deleted: true };
      }
      // The host fetches the file and saves it; the bytes never enter the
      // sandbox, which has no network access of its own.
      case 'fs.download': {
        if (!this.namedCalls.has('realm.fs.download')) {
          throw notNamedError('realm.fs.download');
        }
        let sourceUrl = downloadSource(args[0]);
        let url = this.resolve(method, args[1]);
        // The realm infers the file type from the extension.
        if (!FILE_EXTENSION_RE.test(url.slice(url.lastIndexOf('/') + 1))) {
          throw new Error(
            `realm.fs.download needs a path with a file extension, so the realm knows the file type: ${url}`,
          );
        }
        // Only creates, the same as realm.fs.writeText.
        if ((await this.lookup(url)) !== undefined) {
          throw new Error(`File already exists: ${url}`);
        }
        let left = MAX_DOWNLOAD_BYTES_PER_RUN - this.downloadedBytes;
        let maxBytes = Math.min(MAX_DOWNLOAD_FILE_SIZE, left);
        let bytes: Uint8Array;
        try {
          bytes = await this.download(sourceUrl, maxBytes);
        } catch (error) {
          if (error instanceof DownloadTooLarge) {
            throw new Error(
              maxBytes < MAX_DOWNLOAD_FILE_SIZE
                ? `realm.fs.download accepts at most ${MAX_DOWNLOAD_BYTES_PER_RUN} bytes per run: ${sourceUrl} is larger than the ${left} bytes left`
                : `realm.fs.download accepts at most ${MAX_DOWNLOAD_FILE_SIZE} bytes per file: ${sourceUrl} is larger`,
            );
          }
          throw error;
        }
        // Charged as soon as the bytes arrive, so a save that fails or is
        // refused below cannot be retried past the per-run limit.
        this.downloadedBytes += bytes.byteLength;
        if (bytes.byteLength === 0) {
          throw new Error(`${sourceUrl} returned an empty file`);
        }
        if (this.closed) {
          this.refused += 1;
          throw new Error(`The run has ended; ${url} was not saved`);
        }
        await this.writeBinaryFile(url, bytes);
        this.binaryDigests.set(url, await sha256(bytes));
        // The lookup above recorded the file as missing.
        this.known.delete(url);
        this.binary.add(url);
        this.markCreated(url);
        this.noteBinaryCreate(url);
        return {
          path: this.relative(url),
          size: bytes.byteLength,
          saved: true,
        };
      }
      case 'operations.capabilities':
        return await this.askCapabilities(args[0]);
      case 'capture': {
        let { url, path } = this.captureTarget(args[0]);
        return await this.captures.take(url, path, args[1]);
      }
      case 'images.generate':
        return await this.generateAndSaveImage(args[0]);
      // A new workspace is its own realm: this run cannot write to it. The
      // script gets its URL, to run more realm code in it.
      case 'workspaces.create': {
        let options = args[0] ?? {};
        if (typeof options !== 'object' || Array.isArray(options)) {
          throw new TypeError(
            'realm.workspaces.create expects an options object: { name, endpoint }',
          );
        }
        let { name, endpoint } = options as Record<string, unknown>;
        for (let [key, value] of Object.entries({ name, endpoint })) {
          if (
            value !== undefined &&
            value !== null &&
            typeof value !== 'string'
          ) {
            throw new TypeError(
              `realm.workspaces.create expects ${key} to be a string`,
            );
          }
        }
        if (this.createdWorkspaces.length >= MAX_WORKSPACES) {
          throw new Error(
            `Realm code may create at most ${MAX_WORKSPACES} workspaces`,
          );
        }
        let creating = this.createWorkspace({
          name: (name as string | null) ?? undefined,
          endpoint: (endpoint as string | null) ?? undefined,
        });
        // The realm server cannot cancel a create, so a run that ends while
        // one is in flight reports without it. Log the URL if it lands later.
        let { signal } = this.inFlight;
        let created = await new Promise<{ url: string; name: string }>(
          (resolve, reject) => {
            let onAbort = () =>
              reject(
                new Error(
                  'The run has ended; the workspace create was not awaited',
                ),
              );
            if (signal.aborted) {
              onAbort();
            }
            signal.addEventListener('abort', onAbort, { once: true });
            creating
              .then((workspace) => {
                if (signal.aborted) {
                  log.warn(
                    `Workspace ${workspace.url} was created after the run ended`,
                  );
                }
                resolve(workspace);
              }, reject)
              .finally(() => {
                signal.removeEventListener('abort', onAbort);
              });
          },
        );
        this.createdWorkspaces.push(created.url);
        this.goneWorkspaces.delete(created.url);
        return created;
      }
      case 'workspaces.delete': {
        if (!this.namedCalls.has('realm.workspaces.delete')) {
          throw notNamedError('realm.workspaces.delete');
        }
        let realmIdentifier = args[0];
        if (typeof realmIdentifier !== 'string' || !realmIdentifier) {
          throw new TypeError(
            'realm.workspaces.delete expects the URL of a workspace',
          );
        }
        let deleted = await this.deleteWorkspace(realmIdentifier);
        this.deletedWorkspaces.push(deleted.url);
        this.goneWorkspaces.add(deleted.url);
        return { url: deleted.url, deleted: true };
      }
      case 'room.enableSkills':
        return await this.room.enableSkills(args[0]);
      case 'room.disableSkills':
        return this.room.disableSkills(args[0]);
      case 'room.setModel':
        return await this.room.setModel(args[0]);
      case 'room.credits':
        return await this.room.credits();
      case 'ui.switchSubmode': {
        let submode = args[0];
        if (submode !== 'interact' && submode !== 'code') {
          throw new TypeError(
            "realm.ui.switchSubmode expects 'interact' or 'code'",
          );
        }
        return this.queueUiAction({ action: 'switchSubmode', submode });
      }
      case 'ui.openFile': {
        let url = this.resolve(method, args[0]);
        if (!(await this.exists(url))) {
          throw new Error(`File not found: ${url}`);
        }
        return this.queueUiAction({ action: 'openFile', url });
      }
      case 'ui.previewFormat': {
        let [path, format = 'isolated'] = args;
        if (
          typeof format !== 'string' ||
          !PREVIEW_FORMATS.includes(format as Format)
        ) {
          throw new TypeError(
            `realm.ui.previewFormat expects a card path and one of these formats: ${PREVIEW_FORMATS.join(', ')}`,
          );
        }
        // A card is named by its instance path, with or without `.json`.
        let url = this.resolve(method, path);
        let fileURL = url.endsWith('.json') ? url : `${url}.json`;
        let content = await this.load(fileURL);
        if (content === undefined) {
          throw new Error(`Card not found: ${fileURL}`);
        }
        let module: unknown;
        try {
          module = JSON.parse(content)?.data?.meta?.adoptsFrom?.module;
        } catch {
          // reported below
        }
        if (typeof module !== 'string') {
          throw new Error(`Not a card instance: ${fileURL}`);
        }
        // `adoptsFrom` names the module without its extension, as code mode
        // does for a card definition. Only a relative module is joined to the
        // instance; a prefix-form one, such as a type from base, stays as it
        // is and becomes a URL when the action runs.
        let modulePath = isRelativePath(module)
          ? new URL(module, fileURL).href
          : module;
        if (!/\.(gts|ts)$/.test(modulePath)) {
          modulePath = `${modulePath}.gts`;
        }
        return this.queueUiAction({
          action: 'previewFormat',
          cardId: fileURL.slice(0, -'.json'.length),
          modulePath,
          format: format as Format,
        });
      }
      case 'ui.openWorkspace':
        return this.queueUiAction({ action: 'openWorkspace' });
      // realm.index.invalidate returns once the realm has indexed the paths,
      // so a read later in the same script sees the result. The other calls
      // start their work on the realm server and return without waiting.
      case 'index.invalidate': {
        let paths = typeof args[0] === 'string' ? [args[0]] : args[0];
        if (
          !Array.isArray(paths) ||
          paths.length === 0 ||
          paths.length > MAX_INVALIDATE_PATHS
        ) {
          throw new TypeError(
            `realm.index.invalidate expects a path or an array of 1 to ${MAX_INVALIDATE_PATHS} paths`,
          );
        }
        let urls = paths.map((path) => this.resolve(method, path));
        await this.runIndexCall(method, () => this.index.invalidate(urls));
        let invalidated = urls.map((url) => this.relative(url));
        this.indexActions.push(`invalidate ${invalidated.join(', ')}`);
        return { invalidated };
      }
      case 'index.reindex':
        await this.runIndexCall(method, () => this.index.reindex());
        this.indexActions.push('reindex');
        return { reindex: 'started' };
      case 'index.fullReindex':
        if (!this.namedCalls.has('realm.index.fullReindex')) {
          throw notNamedError('realm.index.fullReindex');
        }
        await this.runIndexCall(method, () => this.index.fullReindex());
        this.indexActions.push('fullReindex');
        return { fullReindex: 'started' };
      case 'index.cancelJob':
        if (!this.namedCalls.has('realm.index.cancelJob')) {
          throw notNamedError('realm.index.cancelJob');
        }
        await this.index.cancelJob();
        this.indexActions.push('cancelJob');
        return { cancelled: true };
      // `call` sends these to `researchCall`, outside the queue.
      case 'web.search':
      case 'web.read':
      case 'resolve':
        return await this.researchCall(method, args);
      case 'activity':
        return this.reportActivity(args[0]);
      case 'plan':
        return this.reportPlan(args[0]);
      case 'ask':
        return await this.askReader(args[0]);
      default:
        throw new Error(`Unknown realm call: ${String(method)}`);
    }
  }

  // realm.ask: the script pauses on a question in its own row, and goes on
  // with the reader's pick. The wait is not the script's time.
  private async askReader(input: unknown): Promise<DeadlineExtension> {
    let request = scriptAsk(input);
    if (!this.ask) {
      throw new Error('realm.ask needs a reader to answer; none is here');
    }
    let ask = this.ask;
    let askedAt = Date.now();
    // The run can end (Stop, its deadline) while the reader has not picked;
    // the question then gives up, so the run's queue settles.
    let { signal } = this.inFlight;
    let onRunEnd: () => void = () => undefined;
    let { answer, label } = await new Promise<{
      answer: string;
      label: string;
    }>((resolve, reject) => {
      onRunEnd = () =>
        reject(new Error('The run has ended; realm.ask got no answer'));
      if (signal.aborted) {
        onRunEnd();
        return;
      }
      signal.addEventListener('abort', onRunEnd, { once: true });
      ask(request).then(resolve, reject);
    }).finally(() => signal.removeEventListener('abort', onRunEnd));
    let line = `Asked: ${request.question} · ${label}`;
    this.activity.push(line);
    this.onActivity?.(line);
    return new DeadlineExtension({ answer, label }, Date.now() - askedAt);
  }

  // Card updates the script asked for that are not saved yet.
  get pendingCardUpdates(): number {
    return this.cardUpdates.size;
  }

  // Merges `attributes` into the card's `data.attributes`. A nested object
  // merges into the value it replaces, so `{ address: { city } }` keeps the
  // address's other fields; an array or any other value replaces it. The
  // change is saved when the script finishes, with every other card update of
  // the run, so the script can update many cards without a save for each.
  private async updateCard(path: unknown, attributes: unknown) {
    if (
      attributes === null ||
      typeof attributes !== 'object' ||
      Array.isArray(attributes)
    ) {
      throw new TypeError(
        'realm.cards.update expects a card path and an attributes object',
      );
    }
    let url = this.resolve('cards.update', path);
    if (!url.endsWith('.json')) {
      url = `${url}.json`;
    }
    let pending = this.cardUpdates.get(url);
    if (!pending) {
      if (this.cardUpdates.size >= MAX_CARD_UPDATES) {
        throw new Error(
          `Realm code may update at most ${MAX_CARD_UPDATES} cards`,
        );
      }
      let expected = await this.cardSource(url);
      let doc: LooseSingleCardDocument | undefined;
      try {
        doc = JSON.parse(expected);
      } catch {
        // reported below
      }
      if (
        !doc?.data ||
        typeof doc.data !== 'object' ||
        !doc.data.meta?.adoptsFrom
      ) {
        throw new Error(`Not a card instance: ${url}`);
      }
      pending = { expected, doc };
    }
    let patch = attributes as Record<string, unknown>;
    let doc = cloneDeep(pending.doc);
    clearReplacedArrayFieldMeta(doc.data.meta, patch);
    doc.data.attributes = mergeWith(
      doc.data.attributes ?? {},
      patch,
      // An array replaces the one in the card, so an item can be removed.
      (_target: unknown, source: unknown) =>
        Array.isArray(source) ? source : undefined,
    );
    // The realm refuses the whole batch for one card over the limit, and only
    // after the script has ended, so the call that makes it too large fails.
    try {
      validateWriteSize(
        JSON.stringify(doc, null, 2),
        this.cardSizeLimitBytes,
        'card',
      );
    } catch (error) {
      throw new Error(
        `Card is too large after this update: ${url}. ${coerceErrorMessage(error, '')}`.trim(),
      );
    }
    this.cardUpdates.set(url, { expected: pending.expected, doc });
    return {
      path: this.relative(url),
      fields: Object.keys(patch),
      saves: 'after the script finishes',
    };
  }

  // A card's file content as the realm holds it, or as this run saved it.
  // It is read without a MAX_FILES slot: card updates have their own limit.
  private async cardSource(url: string): Promise<string> {
    if (this.binary.has(url)) {
      throw new Error(`Not a card instance: ${url}`);
    }
    if (this.known.has(url)) {
      let content = this.known.get(url);
      if (content === undefined) {
        throw new Error(`Card not found: ${url}`);
      }
      return content;
    }
    let source = await this.readSource(url);
    if (source.status === 404) {
      throw new Error(`Card not found: ${url}`);
    }
    if (source.binary) {
      throw new Error(`Not a card instance: ${url}`);
    }
    if (source.status !== 200) {
      throw new Error(`Unable to read ${url}: ${source.status}`);
    }
    if (source.tooLarge || source.content.length > MAX_FILE_SIZE) {
      throw new Error(`File is too large: ${url}`);
    }
    return source.content;
  }

  // Saves every card update of the run in one request, all or none. Called
  // once the script has finished.
  async saveCardUpdates(): Promise<void> {
    if (this.cardUpdates.size === 0) {
      return;
    }
    let updates = [...this.cardUpdates].map(([url, { expected, doc }]) => ({
      url,
      expected,
      content: JSON.stringify(doc, null, 2),
    }));
    await this.saveCards(updates);
    this.cardUpdates.clear();
    for (let { url, expected, content } of updates) {
      this.noteEdit(url, expected, content);
      this.saved.add(url);
    }
  }

  // An operation names the card it acts on by its path, as cards.update does.
  private operationEntry(
    method: RealmRunnerCallMethod,
    path: unknown,
    operation: unknown,
    payload: unknown,
  ): OperationEntry {
    if (typeof operation !== 'string' || operation.length === 0) {
      throw new TypeError(
        `realm.${method} expects a card path and an operation name`,
      );
    }
    if (
      payload !== undefined &&
      payload !== null &&
      (typeof payload !== 'object' || Array.isArray(payload))
    ) {
      throw new TypeError(
        `realm.${method}: the payload of "${operation}" must be an object`,
      );
    }
    let url = this.resolve(method, path);
    let cardId = url.replace(/\.json$/, '');
    // A cards.update of the same card is saved after the script, and would
    // overwrite what the operation did, or be refused for it.
    this.assertNoCardUpdate(`${cardId}.json`);
    return {
      cardId,
      operation,
      payload: (payload ?? undefined) as Record<string, unknown> | undefined,
    };
  }

  // Sends the operations at once, not when the script finishes: the realm
  // can refuse one, and the script reads the answer.
  //
  // invoke and invokeBatchOperation both reach the realm's `_operations`
  // endpoint, not `_atomic`: the realm applies each declaration and its policy
  // authorizes each entry. They differ in what one failure leaves behind. A
  // loop of invoke is one request per card, each committed on its own, so
  // when card 40 of 100 is refused, cards 1 to 39 stay changed. A batch is one
  // request, one commit under one write lock and one indexing pass, and the
  // realm carries out every entry or none.
  private async runOperationEntries(entries: OperationEntry[]) {
    if (this.closed) {
      this.refused += 1;
      throw new Error('The run has ended; the operations were not run');
    }
    // Held while the request is out, so calls the script makes at once cannot
    // pass the limit together, and given back when the operations did not
    // run, so a refused batch, which changed nothing, can be fixed and sent
    // again.
    if (this.operationCount + entries.length > MAX_OPERATIONS) {
      throw new Error(
        `Realm code may run at most ${MAX_OPERATIONS} operations per run`,
      );
    }
    this.operationCount += entries.length;
    let answers: OperationAnswer[];
    try {
      answers = await this.runOperations(entries);
    } catch (error) {
      this.operationCount -= entries.length;
      throw error;
    }
    return entries.map((entry, index) => {
      let path = `${this.relative(entry.cardId)}.json`;
      // The card's text changed on the realm, so this run reads it again.
      this.known.delete(`${entry.cardId}.json`);
      this.operationsRun.push(`${entry.operation} on ${path}`);
      return { path, operation: entry.operation, ...answers[index] };
    });
  }

  // realm.fs does not see a card update until it is saved, so it may not
  // read or change that card in the same run.
  private assertNoCardUpdate(url: string) {
    if (this.cardUpdates.has(url)) {
      throw new Error(
        `${url} has a realm.cards.update that is saved when the script finishes; realm.fs cannot read or change it in the same run`,
      );
    }
  }

  // Paths are relative to the realm root, as in realm-runner. A full file URL
  // inside this realm is accepted too.
  private resolve(method: string, path: unknown): string {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError(`realm.${method} expects a path string`);
    }
    let url: string;
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      url = new URL(path).href;
    } else if (isPrefixForm(path)) {
      url = this.prefixPathURL(path);
    } else {
      if (
        path.startsWith('/') ||
        path.includes('\\') ||
        path
          .split('/')
          .some((part) => part === '..' || part === '.' || part === '')
      ) {
        throw new Error(`Path must be relative to the realm root: ${path}`);
      }
      url = new URL(path, this.realmURL).href;
    }
    if (!url.startsWith(this.realmURL) || url === this.realmURL) {
      throw new Error(`Path is outside this realm: ${path}`);
    }
    return url;
  }

  // A prefix-form path (`@cardstack/catalog/...`) names a realm by its
  // prefix, so it resolves to that realm's URL, not to a path inside this
  // realm. A prefix that is not registered names no realm this run can reach.
  private prefixPathURL(path: string): string {
    try {
      return this.resolveURL(path);
    } catch {
      throw new Error(`Path is outside this realm: ${path}`);
    }
  }

  // Asks the run's realm whether it would allow the user each operation now,
  // and runs none of them. A check names a card by its path, as
  // realm.operations.invoke does, or a type by `{ module, name }`, which is how
  // a create is asked about before the card it would make exists.
  //
  // The realm judges each check as it judges an invocation, by its
  // permissions and its policy, including a grant's condition on the card as
  // it is stored. So the answer is the realm's, not a reading of the policy
  // here. It is advisory all the same: the realm decides again when the
  // operation runs, against the card as it is then.
  private async askCapabilities(raw: unknown): Promise<CapabilityResult[]> {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new TypeError(
        `realm.operations.capabilities expects a non-empty array of checks: ${CAPABILITY_CHECK_SHAPE}`,
      );
    }
    if (this.capabilityCheckCount + raw.length > MAX_CAPABILITY_CHECKS) {
      throw new Error(
        `Realm code may ask about at most ${MAX_CAPABILITY_CHECKS} operations per run`,
      );
    }
    let asked = raw.map((item: unknown) => this.capabilityCheck(item));
    let answers = await this.checkCapabilities(asked.map(({ check }) => check));
    this.capabilityCheckCount += asked.length;
    return asked.map(({ question }, index) => {
      let { allowed, conditional, reason } = answers[index]!;
      return {
        ...question,
        allowed,
        ...(conditional ? { conditional } : {}),
        ...(reason ? { reason } : {}),
      };
    });
  }

  // One check as the realm is asked it, and the question its answer echoes:
  // a card's path in the form the other calls answer with, a type as the
  // script named it. A type's module resolves against the realm root, so a
  // module in this realm may be named `./classroom`; an absolute URL or a
  // prefix form is taken as it is.
  private capabilityCheck(item: unknown): {
    check: CapabilityCheck;
    question: CapabilityQuestion;
  } {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(
        `each realm.operations.capabilities check is ${CAPABILITY_CHECK_SHAPE}`,
      );
    }
    let { path, type, operation } = item as Record<string, unknown>;
    if (typeof operation !== 'string' || operation.length === 0) {
      throw new TypeError(
        `each realm.operations.capabilities check names an operation: ${CAPABILITY_CHECK_SHAPE}`,
      );
    }
    if ((path === undefined) === (type === undefined)) {
      throw new TypeError(
        `a realm.operations.capabilities check names a card by path or a type, one of them: ${CAPABILITY_CHECK_SHAPE}`,
      );
    }
    if (path !== undefined) {
      let cardId = this.resolve('operations.capabilities', path).replace(
        /\.json$/,
        '',
      );
      return {
        check: { target: cardId, operation },
        question: { path: `${this.relative(cardId)}.json`, operation },
      };
    }
    let { module, name } = (type ?? {}) as Record<string, unknown>;
    if (
      typeof module !== 'string' ||
      typeof name !== 'string' ||
      name.length === 0 ||
      !(
        isAbsoluteIdentifier(module) ||
        module.startsWith('./') ||
        module.startsWith('../')
      )
    ) {
      throw new TypeError(
        `a realm.operations.capabilities type is { module, name }: module a URL, a prefix form such as @cardstack/catalog/..., or a path from the realm root that starts with ./`,
      );
    }
    return {
      check: {
        target: {
          module: rri(resolveRRIReference(module, rri(this.realmURL))),
          name,
        },
        operation,
      },
      question: { type: { module, name }, operation },
    };
  }

  // Finds cards, specs and files across realms, the catalog among them, and
  // answers with a summary of each: no live card and no file content.
  private async searchEntriesFor(
    rawQuery: unknown,
    rawOptions: unknown,
  ): Promise<{
    entries: EntrySummary[];
    total: number;
    truncated: boolean;
    incomplete: boolean;
  }> {
    if (
      rawQuery === null ||
      typeof rawQuery !== 'object' ||
      Array.isArray(rawQuery)
    ) {
      throw new TypeError('realm.entries.search expects a query object');
    }
    if ('page' in rawQuery) {
      throw new Error(
        'realm.entries.search does not page; pass { limit } in the options and narrow the query to see other entries',
      );
    }
    let options = (rawOptions ?? {}) as Record<string, unknown>;
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError(
        'realm.entries.search expects an options object: { realms, scope, limit }',
      );
    }
    let { realms, scope, limit } = options;
    if (
      realms !== undefined &&
      (!Array.isArray(realms) ||
        realms.some((realm) => typeof realm !== 'string'))
    ) {
      throw new TypeError(
        'realms must be an array of realm URLs or identifiers such as @cardstack/catalog/',
      );
    }
    if (scope !== undefined && typeof scope !== 'string') {
      throw new TypeError("scope must be one of 'cards', 'files', 'all'");
    }
    if (
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isFinite(limit))
    ) {
      throw new TypeError('limit must be a number');
    }
    let size =
      limit === undefined
        ? DEFAULT_ENTRY_RESULTS
        : Math.min(Math.max(Math.floor(limit), 1), MAX_ENTRY_RESULTS);
    let query = pruneEmptyQueryParts(rawQuery as Query);
    assertQuery(query);
    // Refused here rather than in the search, so a call refused before
    // anything is sent is not reported as a failed search.
    resolveSearchEntryScope(scope);
    let searchRealms = this.resolveSearchRealms(realms as string[] | undefined);
    if (searchRealms.length === 0) {
      return { entries: [], total: 0, truncated: false, incomplete: false };
    }
    let found;
    try {
      found = await searchEntrySummaries(this.searchEntries, query, {
        scope,
        limit: size,
        realms: searchRealms,
      });
    } catch (error) {
      this.recordEntriesSearch({ query, realms: searchRealms, error });
      throw error;
    }
    let { rows, total, incomplete, realmTotals } = found;
    let record = (error?: unknown) =>
      this.recordEntriesSearch({
        query,
        realms: searchRealms,
        found: { total, realmTotals, rowURLs: rows.map((row) => row.url) },
        error,
      });
    let resultSize = 0;
    for (let [index, row] of rows.entries()) {
      resultSize += JSON.stringify(row).length;
      if (resultSize > MAX_ENTRY_RESULT_SIZE) {
        let error = new Error(
          index > 0
            ? `These entries are too large to return; search again with limit ${index} or less`
            : `The entry ${row.url} is too large to return from a search`,
        );
        record(error);
        throw error;
      }
    }
    record();
    for (let row of rows) {
      let seen = this.found.get(row.url);
      if (!seen || (row.matchRelevance ?? 0) > (seen.matchRelevance ?? 0)) {
        this.found.set(row.url, row);
      }
    }
    this.onFound?.(
      [...this.found.values()].sort(
        (a, b) => (b.matchRelevance ?? 0) - (a.matchRelevance ?? 0),
      ),
    );
    return {
      entries: rows,
      total,
      // More entries match than this answer holds.
      truncated: rows.length < total,
      // A realm that failed to answer is reported here, not thrown: the realms
      // that answered still count, and this keeps their answer marked partial.
      incomplete,
    };
  }

  // A directory path takes the same forms as a file path, with or without a
  // trailing slash. No path, or an empty one, is the realm root; a missing
  // argument arrives as null, since the call's arguments cross as JSON.
  private resolveDirectory(path: unknown): string {
    // '/' and '.' name the realm's root as '' does: trimming the slash off
    // '/' would otherwise leave no path at all
    if (
      path === undefined ||
      path === null ||
      path === '' ||
      path === '/' ||
      path === '.' ||
      path === './'
    ) {
      return this.realmURL;
    }
    if (
      typeof path === 'string' &&
      (/^[a-z][a-z0-9+.-]*:/i.test(path) || isPrefixForm(path))
    ) {
      let url = isPrefixForm(path)
        ? this.prefixPathURL(path)
        : new URL(path).href;
      if ((url.endsWith('/') ? url : `${url}/`) === this.realmURL) {
        return this.realmURL;
      }
    }
    let url = this.resolve(
      'fs.list',
      typeof path === 'string' && path.endsWith('/') ? path.slice(0, -1) : path,
    );
    return url.endsWith('/') ? url : `${url}/`;
  }

  private queueUiAction(action: UiAction) {
    if (this.uiActions.length >= MAX_UI_ACTIONS) {
      throw new Error(
        `Realm code may ask for at most ${MAX_UI_ACTIONS} realm.ui actions`,
      );
    }
    this.uiActions.push(action);
    return { action: action.action, runs: 'after the script finishes' };
  }

  // Asks the model for one image and saves it as a new file. The image bytes
  // never enter the sandbox: the script gets the saved path, to link it from
  // a card.
  private async generateAndSaveImage(options: unknown) {
    if (!this.namedCalls.has('realm.images.generate')) {
      throw notNamedError('realm.images.generate');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError(
        'realm.images.generate expects an options object: { prompt, path, sourceImageUrl, llmModel }',
      );
    }
    let { prompt, path, sourceImageUrl, llmModel } = options as Record<
      string,
      unknown
    >;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new TypeError('realm.images.generate requires a prompt string');
    }
    for (let [key, value] of Object.entries({ sourceImageUrl, llmModel })) {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new TypeError(
          `realm.images.generate expects ${key} to be a string`,
        );
      }
    }
    let url = this.resolve('images.generate', path);
    // A source image is a data URL or a file in this realm, named by its path
    // or full URL. It is read with the user's session, so it may not come
    // from another realm the user can read.
    let source =
      typeof sourceImageUrl === 'string' && sourceImageUrl
        ? /^data:/i.test(sourceImageUrl)
          ? sourceImageUrl
          : this.resolve('images.generate', sourceImageUrl)
        : undefined;
    if (this.imagesRequested >= MAX_IMAGES) {
      throw new Error(`Realm code may generate at most ${MAX_IMAGES} images`);
    }
    let timeLeft = IMAGE_TIME_BUDGET_MS - this.imageTimeUsed;
    if (timeLeft <= 0) {
      throw new Error(
        `Realm code may spend at most ${IMAGE_TIME_BUDGET_MS / 1000} s generating images`,
      );
    }
    // The saved file takes one MAX_FILES slot.
    if (this.known.size + this.binary.size >= MAX_FILES) {
      throw new Error(`Realm code may touch at most ${MAX_FILES} files`);
    }
    // The file extension follows the type of image the model makes, so every
    // name the image may be saved under is checked before the request, and no
    // credit is spent on an image that cannot be saved. These checks read no
    // file into the run, so they take no MAX_FILES slots.
    let base = url.replace(IMAGE_EXTENSION_RE, '');
    let destinations = [
      url,
      ...IMAGE_FILE_EXTENSIONS.map((extension) => `${base}.${extension}`),
    ];
    let taken = (
      await Promise.all(
        [...new Set(destinations)].map(async (destination) =>
          (await this.exists(destination)) ? destination : undefined,
        ),
      )
    ).filter((destination) => destination !== undefined);
    if (taken.length > 0) {
      throw new Error(`File already exists: ${taken.join(', ')}`);
    }
    this.imagesRequested += 1;
    let limit = Math.min(IMAGE_TIMEOUT_MS, timeLeft);
    let timeout = AbortSignal.timeout(limit);
    let started = Date.now();
    let image: GeneratedImage;
    try {
      image = await this.generateImage({
        prompt: prompt.trim(),
        sourceImageUrl: source,
        llmModel: (llmModel as string | null) ?? undefined,
        signal: AbortSignal.any([this.inFlight.signal, timeout]),
      });
    } catch (error) {
      if (this.inFlight.signal.aborted) {
        throw new Error('The run has ended; the image request was stopped');
      }
      if (timeout.aborted) {
        throw new Error(
          `realm.images.generate did not finish within ${Math.round(limit / 1000)} s`,
        );
      }
      throw error;
    } finally {
      this.imageTimeUsed += Date.now() - started;
    }
    let savedURL = `${base}.${imageExtension(image.mimeType)}`;
    if (this.closed) {
      this.refused += 1;
      throw new Error(`The run has ended; ${savedURL} was not saved`);
    }
    let bytes = decodeBase64(image.base64.replace(/\s+/g, ''));
    await this.writeBinaryFile(savedURL, bytes);
    this.binaryDigests.set(savedURL, await sha256(bytes));
    // An earlier lookup may have recorded the file as missing.
    this.known.delete(savedURL);
    this.binary.add(savedURL);
    this.markCreated(savedURL);
    this.noteBinaryCreate(savedURL);
    return {
      path: this.relative(savedURL),
      contentType: image.mimeType,
      size: bytes.byteLength,
      saved: true,
    };
  }

  // Unlike `load`, this reads no content into the run, so it neither counts
  // toward MAX_FILES nor refuses a large file.
  private async exists(url: string): Promise<boolean> {
    if (this.known.has(url)) {
      return this.known.get(url) !== undefined;
    }
    if (this.binary.has(url)) {
      return true;
    }
    let source = await this.readSource(url);
    if (source.status !== 200 && source.status !== 404) {
      throw new Error(`Unable to read ${url}: ${source.status}`);
    }
    return source.status === 200;
  }

  // The card or file a script names to show, as a URL; a card's `.json` is
  // dropped, so it is the instance URL. Takes the same path forms as a file.
  cardURL(path: unknown): string {
    if (typeof path !== 'string') {
      throw new TypeError('`show` must be a card or file path string');
    }
    return this.resolve('show', path).replace(/\.json$/, '');
  }

  // What `realm.capture` captures. A relative path resolves inside this realm,
  // as for every other call. A full URL or a prefixed card id (`@scope/...`)
  // may name a card or file in any workspace: the capture itself refuses one
  // the user cannot read. The result names a target this realm holds by its
  // path, and any other — one in a workspace nested under this realm's URL
  // too — by what the script gave.
  private captureTarget(path: unknown): { url: string; path: string } {
    if (
      typeof path === 'string' &&
      (/^[a-z][a-z0-9+.-]*:/i.test(path) || isPrefixForm(path))
    ) {
      let reference = path.trim();
      return {
        url: reference,
        path:
          reference.startsWith(this.realmURL) &&
          reference !== this.realmURL &&
          this.heldByThisRealm(reference)
            ? this.relative(reference)
            : reference,
      };
    }
    let url = this.resolve('capture', path);
    return { url, path: this.relative(url) };
  }

  private relative(url: string): string {
    return url.slice(this.realmURL.length);
  }

  // Why realm.cards.get found no card, with the next step that helps: a read
  // again only for a card a running index pass may still add, and otherwise
  // the call that indexes the file or the fix its error needs. A model that
  // is told to wait for a card no pass will add polls, or edits the card to
  // make the realm index it.
  private cardReadError(id: string, read: Exclude<CardRead, { doc: unknown }>) {
    let path = `${this.relative(id)}.json`;
    switch (read.unread) {
      // The realm-level flag can stay set after a pass whose end event was
      // lost, so the read-again advice carries the same way out as an idle
      // workspace's: an extra invalidate costs one more pass.
      case 'indexing':
        return (
          `Card is not indexed yet: ${id}; read it again in a moment. If it ` +
          `is still not indexed after a few reads, ` +
          (this.mayWrite
            ? `index the file with realm.index.invalidate('${path}')`
            : `tell the user that ${path} needs indexing again by someone ` +
              `who can write to it`)
        );
      case 'unindexed':
        return (
          `Card is not indexed: ${id}. Its file ${path} is in the workspace, ` +
          `and the workspace is not indexing, so reading the card again ` +
          `will not find it. ` +
          (this.mayWrite
            ? `Index the file with realm.index.invalidate('${path}'), then ` +
              `read the card again. Do not edit the card to make the ` +
              `workspace index it`
            : `You can only read this workspace, so tell the user that ` +
              `${path} needs indexing again by someone who can write to it`)
        );
      case 'not-found':
        return `Card not found: ${id}`;
      case 'not-a-card':
        return (
          `Not a card: ${this.relative(id)} is a file, so realm.cards.get ` +
          `cannot read it; read it with realm.fs.readText if it is text, or ` +
          `look at it with realm.capture`
        );
      case 'error':
        return (
          `Card failed to index: ${id}: ${read.message.replace(/[.\s]+$/, '')}. ` +
          `Reading it again gives the same error until its cause is fixed, ` +
          `in ${path}, in the definition it adopts from, or in a card it ` +
          `links to`
        );
      case 'unreadable':
        return `Unable to read card ${id}: ${read.message}`;
    }
  }

  private async searchCards(raw: unknown): Promise<{
    cards: FoundCard[];
    total: number;
    truncated: boolean;
  }> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('realm.cards.search expects a query object');
    }
    if ('realm' in raw || 'realms' in raw) {
      throw new Error(
        'realm.cards.search searches only this realm; to search another realm, run code in that realm',
      );
    }
    let query = pruneEmptyQueryParts(raw as Query);
    assertQuery(query);
    let requested = query.page?.size;
    let size =
      typeof requested === 'number' && Number.isFinite(requested)
        ? Math.min(Math.max(Math.floor(requested), 1), MAX_SEARCH_RESULTS)
        : DEFAULT_SEARCH_RESULTS;
    let wireQuery = searchEntryWireQueryFromQuery(
      composeSearchEntriesQuery(query, 'cards').query,
      { fields: ['item'], scope: 'cards' },
    );
    wireQuery.page = { ...wireQuery.page, size };
    let doc = await this.search(wireQuery);
    // A realm that fails to answer is reported in the result, not thrown.
    // Answering with no cards would read as a search that found none.
    if (doc.meta.incomplete) {
      throw new Error(
        `The search in ${this.realmURL} did not answer; no cards were returned`,
      );
    }

    let items = new Map<string, CardResource<Saved>>();
    for (let resource of doc.included ?? []) {
      if (resource.type === 'card') {
        items.set(resourceIdentity(resource.type, resource.id), resource);
      }
    }
    let cards: FoundCard[] = [];
    let resultSize = 0;
    for (let entry of doc.data) {
      let itemRef = entry.relationships?.item?.data;
      let item =
        itemRef && items.get(resourceIdentity(itemRef.type, itemRef.id));
      let card = entry.id && item ? this.foundCard(entry.id, item) : undefined;
      if (!card) {
        continue;
      }
      resultSize += JSON.stringify(card).length;
      if (resultSize > MAX_SEARCH_RESULT_SIZE) {
        throw new Error(
          cards.length > 0
            ? `This page of cards is too large to return; search again with page.size ${cards.length} or less`
            : `The card ${card.path} is too large to return from a search; read it with realm.fs.readText`,
        );
      }
      cards.push(card);
    }
    let total = doc.meta.page.total;
    let start = (wireQuery.page.number ?? 0) * size;
    // More cards match than this page and the pages before it hold.
    let truncated = start + doc.data.length < total;
    return { cards, total, truncated };
  }

  private foundCard(
    entryId: string,
    item: CardResource<Saved>,
  ): FoundCard | undefined {
    let id = this.resolveURL(entryId);
    if (!id.startsWith(this.realmURL)) {
      return undefined;
    }
    let file = this.relative(id);
    let path = file.endsWith('.json') ? file : `${file}.json`;
    // An item's references are relative to its own id.
    let adoptsFrom = item.meta.adoptsFrom;
    let type = isResolvedCodeRef(adoptsFrom)
      ? {
          module: this.resolveURL(adoptsFrom.module, id),
          name: adoptsFrom.name,
        }
      : undefined;
    let relationships: FoundCard['relationships'] = {};
    for (let [field, value] of Object.entries(item.relationships ?? {})) {
      let self = (value as Relationship | null)?.links?.self;
      relationships[field] = self ? this.resolveURL(self, id) : null;
    }
    return {
      id,
      path,
      ...(type ? { type } : {}),
      attributes: item.attributes ?? {},
      relationships,
    };
  }

  // Downloads within DOWNLOAD_TIMEOUT_MS, and stops when the run ends.
  private async download(
    sourceUrl: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    // The run can end while an unawaited call waits on its lookup. An abort
    // listener added after that would never fire, so nothing is fetched.
    if (this.inFlight.signal.aborted) {
      this.refused += 1;
      throw new Error(`The run has ended; ${sourceUrl} was not downloaded`);
    }
    let stop = new AbortController();
    let timer = setTimeout(
      () =>
        stop.abort(
          new Error(
            `Downloading ${sourceUrl} took longer than ${DOWNLOAD_TIMEOUT_MS / 1000} s`,
          ),
        ),
      DOWNLOAD_TIMEOUT_MS,
    );
    let onRunEnd = () =>
      stop.abort(
        new Error(`The run has ended; ${sourceUrl} was not downloaded`),
      );
    this.inFlight.signal.addEventListener('abort', onRunEnd, { once: true });
    try {
      // A fetch that ignores the signal still ends the call when it aborts.
      return await new Promise<Uint8Array>((resolve, reject) => {
        stop.signal.addEventListener(
          'abort',
          () => reject(stop.signal.reason),
          { once: true },
        );
        this.downloadFile(sourceUrl, maxBytes, stop.signal).then(
          resolve,
          reject,
        );
      });
    } finally {
      clearTimeout(timer);
      this.inFlight.signal.removeEventListener('abort', onRunEnd);
    }
  }

  private async load(url: string): Promise<string | undefined> {
    let content = await this.lookup(url);
    if (content === BINARY) {
      throw new Error(`${url} is a binary file; realm.fs reads only text`);
    }
    if (content !== undefined && !this.readUrls.has(url)) {
      this.readUrls.add(url);
      this.bytesRead += content.length;
    }
    return content;
  }

  // A text file's content, BINARY for a binary file, or undefined for a file
  // that does not exist. A file is text when its bytes are UTF-8, so saving
  // the text back writes the same bytes. Any other file would come back
  // changed, so a copy or edit of it is refused. The decode drops a leading
  // BOM, as the realm does when it saves text.
  private async lookup(
    url: string,
  ): Promise<string | typeof BINARY | undefined> {
    this.assertNoCardUpdate(url);
    if (this.known.has(url)) {
      return this.known.get(url);
    }
    if (this.binary.has(url)) {
      return BINARY;
    }
    if (this.known.size + this.binary.size >= MAX_FILES) {
      throw new Error(`Realm code may touch at most ${MAX_FILES} files`);
    }
    let source = await this.readSource(url);
    if (source.binary) {
      this.binary.add(url);
      return BINARY;
    }
    if (source.status !== 200 && source.status !== 404) {
      throw new Error(`Unable to read ${url}: ${source.status}`);
    }
    if (source.tooLarge) {
      throw new Error(`File is too large: ${url}`);
    }
    let content = source.status === 404 ? undefined : source.content;
    if (content !== undefined && content.length > MAX_FILE_SIZE) {
      throw new Error(`File is too large: ${url}`);
    }
    this.known.set(url, content);
    return content;
  }

  private async save(
    url: string,
    content: string,
    expected: string | undefined,
    options?: { lint?: boolean },
  ) {
    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File is too large after editing: ${url}`);
    }
    if (this.closed) {
      this.refused += 1;
      throw new Error(`The run has ended; ${url} was not saved`);
    }
    let saved = await this.writeFile(url, content, expected, options);
    if (saved === undefined) {
      if (!this.saved.has(url)) {
        this.unchanged.add(url);
      }
      return;
    }
    this.unchanged.delete(url);
    this.noteEdit(url, expected, saved);
    this.known.set(url, saved);
    if (expected === undefined) {
      this.markCreated(url);
    } else {
      this.saved.add(url);
    }
  }

  // A file's first `before` stays; its `after` is the latest. A file the
  // run created and then deleted is no change at all.
  private noteEdit(
    url: string,
    before: string | undefined,
    after: string | undefined,
  ) {
    let previous = this.edits.get(url);
    let first = previous ? previous.before : before;
    if (first === undefined && after === undefined) {
      this.edits.delete(url);
      return;
    }
    this.edits.set(url, { before: first, after });
  }

  private noteBinaryCreate(url: string) {
    this.edits.set(url, { binarySha256: this.binaryDigests.get(url) });
  }

  private markCreated(url: string) {
    this.created.add(url);
    this.saved.add(url);
    // A file created again after a delete is reported as saved.
    this.deleted.delete(url);
    this.deletedExisting.delete(url);
  }

  // What the run knows of a file it has just deleted.
  private forgetDeleted(url: string) {
    this.created.delete(url);
    this.saved.delete(url);
    this.unchanged.delete(url);
    this.binary.delete(url);
    this.binaryDigests.delete(url);
    this.known.set(url, undefined);
  }
}

// A script's question to the reader, as realm.ask takes it.
export interface ScriptAsk {
  question: string;
  kind: 'options' | 'cards' | 'swatches' | 'recommend';
  options: {
    label: string;
    value: string;
    cardId?: string;
    color?: string;
    detail?: string;
    confidence?: string;
  }[];
  allowOther: boolean;
}

function scriptAsk(input: unknown): ScriptAsk {
  let request = (input ?? {}) as Record<string, unknown>;
  let question = request.question;
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 300
  ) {
    throw new TypeError(
      'realm.ask expects { question: string (up to 300 characters), options: [{ label, value?, cardId?, color?, detail?, confidence? }], kind?, allowOther? }',
    );
  }
  let kind: ScriptAsk['kind'] =
    request.kind === 'cards' ||
    request.kind === 'swatches' ||
    request.kind === 'recommend'
      ? request.kind
      : 'options';
  let options = Array.isArray(request.options) ? request.options : [];
  if (options.length < 1 || options.length > 8) {
    throw new TypeError('realm.ask takes 1 to 8 options');
  }
  return {
    question: question.trim(),
    kind,
    allowOther: request.allowOther === true,
    options: options.map((option, index) => {
      let o = (option ?? {}) as Record<string, unknown>;
      let label = typeof o.label === 'string' ? o.label : String(o.value ?? '');
      if (!label) {
        throw new TypeError(`realm.ask option ${index + 1} needs a label`);
      }
      return {
        label,
        value: typeof o.value === 'string' ? o.value : label,
        cardId: typeof o.cardId === 'string' ? o.cardId : undefined,
        color: typeof o.color === 'string' ? o.color : undefined,
        detail: typeof o.detail === 'string' ? o.detail : undefined,
        confidence: typeof o.confidence === 'string' ? o.confidence : undefined,
      };
    }),
  };
}

// The run's quiet record: what it copied, and how much it read.
function runSummary(session: RealmFsSession): string[] {
  let lines = session.copies.map((copy) => `Copied ${copy}`);
  let reads = session.readUrls.size;
  if (reads > 0) {
    let kb = Math.max(1, Math.round(session.bytesRead / 1024));
    lines.push(`Read ${reads} ${reads === 1 ? 'file' : 'files'} · ${kb} KB`);
  }
  return lines;
}

// The compact diff of one file the run changed, for the result.
// What a run changed on a card it saved, field by field, for the
// transcript's change table and the model.
function fileCardChanges(
  session: RealmFsSession,
  url: string,
): CardFieldChange[] {
  if (!url.endsWith('.json')) {
    return [];
  }
  let edit = session.edits.get(url);
  return edit && edit.before !== undefined
    ? cardChanges(edit.before, edit.after)
    : [];
}

function withCardChanges(detail: string, changes: CardFieldChange[]): string {
  return changes.length
    ? `${detail}${CARD_CHANGES_IN_DETAIL}${JSON.stringify(changes)}`
    : detail;
}

function fileDiff(session: RealmFsSession, url: string): string | undefined {
  let edit = session.edits.get(url);
  return edit ? compactDiff({ url, ...edit }) : undefined;
}

// What a failed run reports: the error, and everything the run already did,
// so the model knows what state it left and a retry does not repeat it.
function failureReport(session: RealmFsSession, error: unknown): string {
  // Writes are saved as they happen, so a failed run can have saved some
  // files already. Name them, so the model knows what state it left.
  let message = error instanceof Error ? error.message : String(error);
  let saved = [...session.saved];
  // A call the script did not await either finished before the session
  // closed, and is named as saved, or was refused after it closed. Which
  // one happened depends on timing, so record it.
  log.debug(
    `run failed: saved=${saved.length} refusedAfterClose=${session.refusedAfterClose}: ${message}`,
  );
  // A thrown message is often a full sentence already; end it with one
  // period, not two.
  let trimmed = message.trimEnd();
  let sentence = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  let report =
    saved.length > 0
      ? `${sentence} Files already saved by this run: ${saved.join(', ')}`
      : `${sentence} No file was saved.`;
  if (session.deleted.size > 0) {
    report += ` Files this run created and already deleted: ${[...session.deleted].join(', ')}`;
  }
  // A delete of a file from before the run cannot be undone, so the
  // model must know it happened.
  if (session.deletedExisting.size > 0) {
    report += ` Files that existed before this run and that it already deleted: ${[...session.deletedExisting].join(', ')}`;
  }
  // Workspaces stay created too. Name them, so a retry does not create
  // them again. The run failed, so none of them is opened.
  if (session.createdWorkspaces.length > 0) {
    report += ` Workspaces already created by this run: ${session.createdWorkspaces.join(', ')}`;
  }
  // A delete cannot be undone, so the model must know it happened.
  if (session.deletedWorkspaces.length > 0) {
    report += ` Workspaces already deleted by this run: ${session.deletedWorkspaces.join(', ')}`;
  }
  // Index actions start on the realm server when the call returns, so
  // name them, so a retry does not start a full reindex again.
  if (session.indexActions.length > 0) {
    report += ` Index actions already started by this run: ${session.indexActions.join('; ')}`;
  }
  // An operation the realm carried out stays done, so name it, so a retry
  // does not run it again.
  if (session.operationsRun.length > 0) {
    report += ` Operations already run by this run: ${session.operationsRun.join('; ')}`;
  }
  // Room changes are made only after a run that finished, so a failed
  // run made none.
  if (session.room.requested) {
    report += ' The room changes it asked for were not made.';
  }
  // UI actions are done only after a run that finished, so a failed run
  // did none.
  if (session.uiActions.length > 0) {
    report += ' The UI actions it asked for were not done.';
  }
  // Card updates are saved only after a run that finished, all or none, so
  // a failed run saved none of them.
  if (session.pendingCardUpdates > 0) {
    report += ' The card updates it asked for were not saved.';
  }
  // Research calls change nothing, but each one is a paid request, so a
  // retry should know which it already made.
  if (session.activity.length > 0) {
    report += ` Research calls this run made: ${session.activity.join('; ')}`;
  }
  return report;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

async function sha256(bytes: Uint8Array): Promise<string> {
  let digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The URL a download reads from: an absolute http or https URL.
function downloadSource(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      'realm.fs.download expects a source URL and a destination path',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `realm.fs.download expects an absolute source URL: ${value}`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `realm.fs.download downloads only http and https URLs: ${value}`,
    );
  }
  return url.href;
}

// The time a run gets on top of RUN_TIMEOUT_MS and CALL_DEADLINE_MS for the
// calls its code names.
function extraRunTimeMs(code: unknown): number {
  return (
    (clickRequiredCallsIn(code).has('realm.images.generate')
      ? IMAGE_TIME_BUDGET_MS
      : 0) +
    (typeof code === 'string' && RESEARCH_CALL_RE.test(code)
      ? RESEARCH_TIME_MS
      : 0)
  );
}

// Accepts plain base64, with or without line breaks, or a base64 data URL.
// The base64 content of a writeBytes call, without a `data:` URL prefix or
// whitespace.
function cleanBase64(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      'realm.fs.writeBytes expects a path and a base64 string',
    );
  }
  let base64 = value.replace(DATA_URL_PREFIX_RE, '').replace(/\s+/g, '');
  if (base64.length === 0) {
    throw new Error('realm.fs.writeBytes requires non-empty content');
  }
  if (base64.length % 4 === 1 || !BASE64_RE.test(base64)) {
    throw new Error('realm.fs.writeBytes content is not valid base64');
  }
  return base64;
}

// How many bytes clean base64 decodes to, without decoding it.
function decodedSize(base64: string): number {
  let padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function decodeBase64(base64: string): Uint8Array {
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// One entry's result as the script reads it. A write names the card it wrote
// and the version that card now holds; a read answers the document, which is
// the one result that carries attributes; a delete answers nothing.
function operationAnswer(
  result: unknown,
  base: BaseOperation,
): OperationAnswer {
  if (!result || typeof result !== 'object') {
    return {};
  }
  if (!isWrite(base)) {
    return { document: result as Record<string, unknown> };
  }
  let { id, version, indexPending } = result as OperationWriteResult;
  return {
    id,
    ...(version ? { version } : {}),
    indexPending: indexPending === true,
  };
}

// What a search answers when every realm it would reach is gated.
function noSearchResults() {
  return { data: [], meta: { page: { total: 0 } } };
}

export default class RunRealmCodeTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmCodeInput,
  typeof BaseToolModule.RunRealmCodeResult
> {
  @service declare private billingService: BillingService;
  @service declare private capabilities: CapabilitiesService;
  @service declare private cardService: CardService;
  @service declare private clientTelemetry: ClientTelemetryService;
  @service declare private environmentService: EnvironmentService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private store: StoreService;
  @service declare private toolService: ToolService;

  description =
    'Run safe Realm code that reads and edits realm source files, finds ' +
    'cards with realm.cards.search, reads cards as JSON data with ' +
    'realm.cards.get, changes card fields with realm.cards.update, runs ' +
    'the operations a card type declares (its @operation statics) with ' +
    'realm.operations.invoke(path, operation, payload), or several in one ' +
    'request with realm.operations.invokeBatchOperation([{ path, operation, ' +
    'payload }]) (prefer them over realm.cards.update when the type ' +
    'declares one for the change; each runs at once and answers { path, ' +
    'operation, id, version } for a write). invoke in a loop sends one ' +
    'request per card, and when one fails the cards before it stay ' +
    'changed; invokeBatchOperation sends all of them in one request that ' +
    'the realm carries out whole or not at all, so use it when the changes ' +
    'must go together or there are many cards. finds ' +
    'cards, specs and files across realms with ' +
    'realm.entries.search, can look at cards and files with realm.capture ' +
    '(a path in the realm, or the URL of a card or file in any workspace ' +
    `the user can read; a ${LOCAL_SOURCE_URL_PREFIX} URL names a file the ` +
    'user attached from their computer or an image a capture took; neither ' +
    'is in a workspace, so realm.capture refuses it), can generate images ' +
    'into the realm with ' +
    'realm.images.generate, can save a file from a URL with ' +
    'realm.fs.download, can search the web with realm.web.search (Exa; ' +
    'returns [{ url, title, snippet }]), can read a web page as markdown ' +
    'with realm.web.read (Firecrawl; throws with the reason a page cannot ' +
    'be read), can repair or normalize data into a JSON schema with ' +
    'realm.resolve (at most 3 calls per run; it refuses requests for code), ' +
    'can reshape JSON with a BXL program with realm.transform(input, ' +
    'program, { params?, spelling? }) (jq spelling by default, with Excel ' +
    'functions taking ; between arguments, such as map({name, total: ' +
    'ROUND(.price * .qty; 2)}); spelling "readable" for readable BXL; ' +
    'params("name") reads a value from params; one value out; no reduce, ' +
    'def, try or @formats; 1 MB in (input and params) and 1 MB out per call, ' +
    '10 MB in and out per run; 10 s per program; at most 100 calls per run), ' +
    'can ask the user a question mid-script and wait for the pick with ' +
    'realm.ask({ question, options: [{ label, value?, detail?, confidence? }], kind?, allowOther? }) ' +
    '(kind "recommend" proposes the first option, with its detail as the reason), ' +
    'can name the steps of a multi-step script up front with ' +
    'realm.plan(["Search calendars", "Read each page", "Compare"]) and ' +
    'report which step it is on with ' +
    'realm.activity({ message, current, total }) (current is 1-based into the ' +
    'plan; add count and of for progress inside a step, e.g. page 3 of 5), ' +
    'can create workspaces with realm.workspaces.create, ' +
    'can change the skills and model of this room with room.*, can read ' +
    "the user's plan, credit balance and this room's spend with " +
    'room.credits(), and can ' +
    'refresh the index of the workspace with realm.index.*. A card that ' +
    'realm.cards.get reports as not indexed while the workspace is not ' +
    'indexing will not index by waiting: run ' +
    "realm.index.invalidate('<card path>.json') and read it again, and " +
    "never edit a card's data to make the workspace index it. In a workspace " +
    'the user can only read, reads work and each write is refused, except ' +
    'realm.operations, which the realm allows when its policy grants the ' +
    'operation. To learn whether the realm would allow the user an ' +
    'operation now, without running it, ask with ' +
    'realm.operations.capabilities([{ path, operation }, { type: { module, ' +
    'name }, operation }]) (a type for a create; module is a URL, a prefix ' +
    'form, or a ./ path from the realm root); it answers each check in ' +
    'order with { allowed, conditional?, reason? }, where conditional means ' +
    "a create's grant matched and its condition is checked against the card " +
    'the create makes. The realm decides again when the operation runs. realm ' +
    'is the root of the workspace, and paths are relative to it, so a file ' +
    'in a folder is named with its folder (folder/file.json). Return ' +
    '{ show: "<card path>" } to open a card in the realm when the run ends. ' +
    'A script that fails to compile, or throws a ReferenceError or ' +
    'TypeError before its first realm call, may be auto-fixed and run ' +
    'again; scriptFixes in the result shows the diff, so write it ' +
    'correctly next time.';
  static actionVerb = 'Run';
  // `room.*` changes the room the call came from. The tool service sets
  // `roomId` to that room, so a model cannot point the changes at another
  // room it has joined.
  static bindsToInvokingRoom = true;
  // The tool service hands each run a progress hook, so the transcript can
  // show `realm.activity` steps and research lines while the run is going.
  static reportsProgress = true;
  onProgress?: (entry: {
    line: string;
    progress?: RealmRunnerProgress;
  }) => void;
  private publishActivity = (line: string, progress?: RealmRunnerProgress) => {
    this.onProgress?.({ line, progress });
  };
  // The tool service hands a run a hook for what its searches found, so the
  // row shows the matches the script read and not only that it searched.
  onFound?: (found: EntrySummary[]) => void;
  private publishFound = (found: EntrySummary[]) => {
    this.onFound?.(found);
  };
  // The tool service hands each run a hook for what it changed, so the tab
  // that ran the call keeps each file's full before and after: the inline
  // diff and Undo read them, whatever base the realm server runs.
  onEdits?: (edits: RealmFileEdit[]) => void;
  // The tool service hands a run a way to ask its reader (realm.ask).
  onAsk?: (request: ScriptAsk) => Promise<{ answer: string; label: string }>;
  private publishEdits(session: RealmFsSession) {
    this.onEdits?.([...session.edits].map(([url, edit]) => ({ url, ...edit })));
  }
  // Stop ends the run the way its deadline does: the script stops, calls in
  // flight are refused, and what it already saved stays and is reported.
  private stopper = new AbortController();
  // Settles STOP_GRACE_MS after Stop, or never.
  private stopGrace = new Promise<void>((resolve) =>
    this.stopper.signal.addEventListener(
      'abort',
      () => setTimeout(resolve, STOP_GRACE_MS),
      { once: true },
    ),
  );
  // `work`, or the stop's reason once Stop has had its grace
  private untilStopped<T>(work: Promise<T>): Promise<T> {
    return Promise.race([
      work,
      this.stopGrace.then(() => {
        throw this.stopper.signal.reason;
      }),
    ]);
  }
  // the session's calls settled, or Stop's grace over. Stop never cuts the
  // wait for a save or delete already under way, so the result reports
  // every change the realm got; only research is given up on.
  private async idleOrStopped(session: RealmFsSession): Promise<unknown> {
    await Promise.race([session.idle(), this.stopGrace]);
    return session.queueSettled();
  }
  stop = () => {
    this.stopper.abort(
      new Error(
        `${STOPPED_BY_USER}. Do not run it again unless they ask you to`,
      ),
    );
  };

  // A run waits for the click when its script names a click-required call.
  static clickReasonsFor(
    attributes: Record<string, unknown> | undefined,
  ): ClickReason[] {
    return [...clickRequiredCallsIn(attributes?.code)].map((call) => ({
      call,
      reason: CLICK_REQUIRED_CALLS[call],
    }));
  }

  // A run that may generate images gets the image time budget on top of the
  // tool service's execute timeout, as it does on its own limits.
  static extraExecuteTimeMsFor(
    attributes: Record<string, unknown> | undefined,
  ): number {
    return extraRunTimeMs(attributes?.code);
  }

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RunRealmCodeInput;
  }

  // `realm` and `roomId` fall back to the workspace and room the call came
  // from, so a model that leaves them out still gets its script run.
  requireInputFields = ['code'];

  protected async run(
    input: BaseToolModule.RunRealmCodeInput,
  ): Promise<BaseToolModule.RunRealmCodeResult> {
    if (!input.code || input.code.length > MAX_CODE_SIZE) {
      throw new Error(
        `Realm code must be between 1 and ${MAX_CODE_SIZE} characters`,
      );
    }
    let realmInput = input.realm || this.operatorModeStateService.realmURL;
    let roomId = input.roomId || this.matrixService.currentRoomId;
    if (!realmInput) {
      throw new Error('Realm code needs a realm to run in');
    }
    if (!roomId) {
      throw new Error('Realm code needs the room it runs for');
    }
    // Resolve to the realm's own identifier: the fallback realm URL can come
    // without the trailing slash a realm root has.
    let realmId = rri(realmInput.endsWith('/') ? realmInput : `${realmInput}/`);
    let realmURL = this.realmOfInput(realmId);
    // Read and write are separate grants, and either one is enough to run:
    // in a workspace the user can only read, each write is refused on its
    // own. In one the user can only write, the realm refuses each read,
    // including the read that a write to a file makes first.
    if (
      !realmURL ||
      !(this.realm.canRead(realmURL) || this.realm.canWrite(realmURL))
    ) {
      throw new Error(`The current user cannot read or write ${realmInput}`);
    }
    let rootURL = this.realmRootURL(realmURL);
    // Paths in the script resolve from the realm root, so a folder, file or
    // card inside the realm is refused rather than replaced by the root: the
    // script's paths would otherwise resolve from somewhere the caller did not
    // name. Which of the three it is isn't known without asking the realm, so
    // the message holds for each. The root is named in the form the model is
    // shown realms in.
    let { virtualNetwork } = this.network;
    let local = new RealmPaths(new URL(rootURL)).local(
      virtualNetwork.toURL(realmId),
    );
    if (local !== '') {
      let root = virtualNetwork.unresolveURL(rootURL);
      throw new Error(
        `${realmInput} is ${local} inside the workspace ${root}, not its ` +
          `root. Pass ${root} as realm, and name each file by its path from ` +
          `there: ${local} for that file, ${local}.json for that card, or ` +
          `${local}/ and the file's name for a file in that folder`,
      );
    }

    let namedCalls = clickRequiredCallsIn(input.code);
    let extraTime = extraRunTimeMs(input.code);
    let runTimeoutMs = RUN_TIMEOUT_MS + extraTime;
    let callDeadlineMs = CALL_DEADLINE_MS + extraTime;
    // The room's features can't change during a run, so read them once, on
    // the first search: reading the room's events loads the room.
    let gateOfRun: ((realm: string) => boolean) | undefined;
    let isGated = (realm: string) =>
      (gateOfRun ??= this.featureGate(roomId))(realm);
    // A script fixed after a failure runs again in a fresh session: it made
    // no realm call the first time, so there is nothing to carry over.
    let newSession = () =>
      new RealmFsSession(
        rootURL,
        (url) => this.readSource(url),
        (url, content, expected, options) =>
          this.writeFile(roomId, url, content, expected, options),
        (updates) => this.saveCards(roomId, rootURL, updates),
        (url, bytes) => this.writeBinaryFile(roomId, url, bytes),
        (url, expected) => this.deleteFile(url, expected),
        (url, maxBytes, signal) => this.downloadFile(url, maxBytes, signal),
        (url) => this.listDirectory(url),
        // The run reads only the rows' own data, so the linked cards' resources
        // are not asked for. A script run in a feature-gated realm finds
        // nothing there unless the room enabled the feature.
        async (query) =>
          isGated(realmURL)
            ? noSearchResults()
            : await this.store.searchEntries(query, [realmURL], {
                linksOnly: true,
              }),
        (reference, base) =>
          this.network.virtualNetwork.resolveURL(reference, base).href,
        (id) => this.readCard(id, realmURL),
        (entries) => this.runOperations(entries),
        (query, realms) => this.store.searchEntries(query, realms),
        // Resolved before the search, so the search and its telemetry
        // record name the same realms.
        (realms) => {
          this.assertKnownRealmIdentifiers(realms);
          return this.store
            .searchRealmsFor(realms)
            .filter((realm) => !isGated(realm));
        },
        (url, options, doneBy, signal) =>
          this.captureURL(url, options, doneBy, signal),
        (reference) =>
          workspaceOf(reference, { network: this.network, realm: this.realm })
            ?.realmURL === rootURL,
        (workspaceInput) =>
          createWorkspace(
            { matrixService: this.matrixService, realm: this.realm },
            workspaceInput,
          ),
        (realmIdentifier) =>
          deleteWorkspace(
            {
              matrixService: this.matrixService,
              operatorModeStateService: this.operatorModeStateService,
              realm: this.realm,
              realmServer: this.realmServer,
              recentFilesService: this.recentFilesService,
            },
            realmIdentifier,
          ),
        (imageInput) => this.generateImage(imageInput),
        namedCalls,
        {
          invalidate: (urls) => this.realm.invalidateUrls(realmURL, urls),
          reindex: () => this.realm.reindex(realmURL),
          fullReindex: () => this.realm.fullReindex(realmURL),
          cancelJob: () => this.realm.cancelIndexingJob(realmURL),
        },
        this.realm.canWrite(realmURL),
        this.environmentService.cardSizeLimitBytes,
        new RoomActions({
          checkSkill: (id) => this.checkSkill(id),
          knownModels: () => this.matrixService.pickableModelIds(roomId),
          credits: () => this.roomCredits(roomId),
        }),
        this.research(roomId),
        (search) =>
          recordCatalogSearch(
            {
              clientTelemetry: this.clientTelemetry,
              network: this.network,
              realmServer: this.realmServer,
            },
            { ...search, tool: 'run-realm-code', realm: rootURL },
          ),
        (checks) => this.capabilities.check(rootURL, checks),
      );
    let session = newSession();
    session.onActivity = this.publishActivity;
    session.onFound = this.publishFound;
    let runnerResult;
    let deadline = new AbortController();
    // The call's own deadline, which a question to the reader pauses.
    let deadlineEndsAt = Date.now() + callDeadlineMs;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let armDeadline = () => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(
        () =>
          deadline.abort(
            new Error(
              `Realm code did not finish within ${callDeadlineMs / 1000} s`,
            ),
          ),
        Math.max(0, deadlineEndsAt - Date.now()),
      );
    };
    armDeadline();
    let askReader = this.onAsk
      ? async (request: ScriptAsk) => {
          let askedAt = Date.now();
          clearTimeout(deadlineTimer);
          try {
            return await this.onAsk!(request);
          } finally {
            deadlineEndsAt += Date.now() - askedAt;
            if (!deadline.signal.aborted) {
              armDeadline();
            }
          }
        }
      : undefined;
    session.ask = askReader;
    // The worker allows the script `runTimeoutMs` once QuickJS is ready;
    // measured from here it is a conservative end, since sandbox start only
    // pushes the real one later.
    let code = input.code;
    // What auto-fix did, for the activity and for the model.
    let fixActivity: string[] = [];
    let scriptFixes: string[] = [];
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        session = newSession();
        session.onActivity = this.publishActivity;
        session.onFound = this.publishFound;
        session.ask = askReader;
      }
      session.captures.runEndsAt = Date.now() + runTimeoutMs;
      try {
        runnerResult = await this.untilStopped(
          runRealmCode(
            {
              code,
              realmURL: rootURL,
              timeoutMs: runTimeoutMs,
            },
            (method, args) => session.call(method, args),
            AbortSignal.any([deadline.signal, this.stopper.signal]),
          ),
        );
        break;
      } catch (error) {
        // Stop the session before reading what it saved: a call the script
        // did not await can still be running, and must neither save after
        // this report nor be missing from it.
        session.close();
        await this.idleOrStopped(session);
        this.publishEdits(session);
        let fixed =
          error instanceof RealmScriptError &&
          autoFixable(error.scriptError, session.callsMade) &&
          attempt < MAX_AUTO_FIX_ATTEMPTS &&
          code.length <= MAX_AUTO_FIX_CODE_CHARS &&
          !deadline.signal.aborted &&
          !this.stopper.signal.aborted
            ? await this.autoFix(code, error.scriptError, deadline.signal)
            : undefined;
        if (!fixed || 'rejected' in fixed) {
          clearTimeout(deadlineTimer);
          let notes = [
            ...(scriptFixes.length
              ? [
                  `The runner auto-fixed the script before this error: ${fixActivity.join('; ')}.`,
                ]
              : []),
            ...(fixed ? [fixed.rejected] : []),
          ];
          throw new Error([failureReport(session, error), ...notes].join(' '));
        }
        code = fixed.code;
        fixActivity.push(fixed.activity);
        this.publishActivity(fixed.activity);
        scriptFixes.push(`${fixed.activity}\n${fixed.diff}`);
      }
    }

    clearTimeout(deadlineTimer);
    session.close();
    await this.idleOrStopped(session);
    try {
      await session.saveCardUpdates();
    } catch (error) {
      this.publishEdits(session);
      throw new Error(failureReport(session, error));
    }
    this.publishEdits(session);
    // what the run read and copied, said once, after its own steps
    let summaryLines = runSummary(session);
    for (let line of summaryLines) {
      this.publishActivity(line);
    }
    await this.openCreatedWorkspace(session);
    let roomChanges = session.room.requested
      ? await this.changeRoom(roomId, session.room.requested)
      : [];
    let shown = await this.showCard(session, runnerResult.scriptResult);
    let commandModule = await this.loadToolModule();
    // UI actions run only after a run that succeeded, and after every file
    // it saved, so what they open is what the run left.
    let uiActions = [];
    for (let action of session.uiActions) {
      uiActions.push(
        new commandModule.RealmCodeUiActionResult(
          await this.applyUiAction(action, realmURL),
        ),
      );
    }
    return new commandModule.RunRealmCodeResult({
      realm: this.realmRootURL(realmURL),
      uiActions,
      ...shown,
      files: [
        ...[...session.saved].map(
          (fileUrl) =>
            new commandModule.RealmCodeFileResult({
              fileUrl,
              status: 'saved',
              detail: withCardChanges(
                session.binary.has(fileUrl)
                  ? 'Binary file saved.'
                  : 'Source saved; correctness validation will run after this tool result.',
                fileCardChanges(session, fileUrl),
              ),
              diff: fileDiff(session, fileUrl),
            }),
        ),
        ...[...session.unchanged].map(
          (fileUrl) =>
            new commandModule.RealmCodeFileResult({
              fileUrl,
              status: 'unchanged',
              detail:
                "Not saved: after lint fixes (which remove unused imports) the text is the same as the file's current text, so nothing changed.",
            }),
        ),
        ...[...session.deleted].map(
          (fileUrl) =>
            new commandModule.RealmCodeFileResult({
              fileUrl,
              status: 'deleted',
              detail: 'Created by this run and then deleted.',
            }),
        ),
        ...[...session.deletedExisting].map(
          (fileUrl) =>
            new commandModule.RealmCodeFileResult({
              fileUrl,
              status: 'deleted',
              detail: 'Existed before this run; deleted.',
              diff: fileDiff(session, fileUrl),
            }),
        ),
      ],
      scriptResult: runnerResult.scriptResult,
      captures: session.captures.taken.map(
        (viewed) =>
          new commandModule.AttachedImageField({
            name: viewed.file.name,
            sourceUrl: viewed.file.sourceUrl,
            url: viewed.file.url,
            contentType: viewed.file.contentType,
            contentHash: viewed.file.contentHash,
            contentSize: viewed.file.contentSize,
            width: viewed.width,
            height: viewed.height,
          }),
      ),
      createdWorkspaces: [...session.createdWorkspaces],
      deletedWorkspaces: [...session.deletedWorkspaces],
      indexActions: [...session.indexActions],
      activity: [...fixActivity, ...session.activity, ...summaryLines],
      scriptFixes,
      roomChanges,
    });
  }

  // Makes the room changes the script asked for, and describes each one. A
  // change that fails is described too: the files are already saved, so the
  // run still reports.
  private async changeRoom(
    roomId: string,
    { skillsToEnable, skillsToDisable, model }: RequestedRoomChanges,
  ): Promise<string[]> {
    let changes: string[] = [];
    if (skillsToEnable.length || skillsToDisable.length) {
      try {
        await new UpdateRoomSkillsTool(this.toolContext).execute({
          roomId,
          skillCardIdsToActivate: skillsToEnable,
          skillCardIdsToDeactivate: skillsToDisable,
        });
        if (skillsToEnable.length) {
          changes.push(`Enabled skills: ${skillsToEnable.join(', ')}`);
        }
        if (skillsToDisable.length) {
          changes.push(`Disabled skills: ${skillsToDisable.join(', ')}`);
        }
      } catch (error) {
        changes.push(
          `Skills were not changed: ${coerceErrorMessage(error, 'unknown error')}`,
        );
      }
    }
    if (model !== undefined) {
      try {
        await new SetActiveLLMTool(this.toolContext).execute({
          roomId,
          model,
        });
        changes.push(`Model set to ${model}`);
      } catch (error) {
        changes.push(
          `Model was not changed: ${coerceErrorMessage(error, 'unknown error')}`,
        );
      }
    }
    return changes;
  }

  // `room.credits()`: the balance is read fresh, since every answer spends
  // from it, and a balance that can't be read is an error rather than an
  // older one.
  private async roomCredits(roomId: string): Promise<RoomCredits> {
    let roomResource = this.matrixService.roomResources.get(roomId);
    if (!roomResource) {
      throw new Error(
        `room.credits cannot read the messages of room ${roomId}`,
      );
    }
    let subscription: SubscriptionData | undefined;
    try {
      subscription = await this.billingService.loadSubscriptionData();
    } catch (error) {
      console.error('room.credits: loading the subscription failed', error);
    }
    if (!subscription) {
      throw new Error(
        "room.credits could not read the account's credits from the server. Try again, or see Profile → Membership Tier",
      );
    }
    // The room's processing restarts when a new event arrives, which cancels
    // the run being awaited; the messages read after it are current either way.
    await Promise.allSettled([roomResource.processing]);
    return roomCredits(
      subscription,
      roomResource.messages.map((message) => message.usage),
    );
  }

  private async checkSkill(id: string): Promise<void> {
    let source;
    try {
      source = await loadSkillSource(this.store, id);
    } catch (error) {
      throw new Error(
        `Unable to load skill ${id}: ${coerceErrorMessage(error, 'unknown error')}`,
      );
    }
    if (!source) {
      throw new Error(`Not a skill card or skill markdown file: ${id}`);
    }
  }

  // The files it saved, then the captures it took.
  resultAttachments(
    result: BaseToolModule.RunRealmCodeResult,
  ): ResultAttachment[] {
    let saved = (result.files ?? []).flatMap((file) =>
      file?.fileUrl && file.status === 'saved'
        ? [{ sourceUrl: file.fileUrl, name: file.fileUrl.split('/').pop() }]
        : [],
    );
    return [...saved, ...uploadedImages(result.captures)];
  }

  // Opens the last workspace the run created, as the create-workspace tool
  // does. It runs once the script has ended, so the script's own realm calls
  // never race a workspace switch. A run that also saved files stays in its
  // realm: the open workspace is the default realm of the next run, which is
  // where validation of those files asks the model to fix them. Opening is
  // only for the UI, so a failure here does not fail the run.
  private async openCreatedWorkspace(session: RealmFsSession) {
    let url = session.createdWorkspaces
      .filter((created) => !session.goneWorkspaces.has(created))
      .at(-1);
    if (!url || session.saved.size > 0) {
      return;
    }
    try {
      await this.operatorModeStateService.openWorkspace(url);
    } catch (error) {
      log.warn(`Could not open new workspace ${url}`, error);
    }
  }

  // A script returns `{ show: 'Path/to-card' }` to open that card when the
  // run ends, or `{ show: 'path/to/file.png' }` to open another file in code
  // mode. The sandbox has no access to the UI: the host opens it, and only
  // after it checks that the path is in this run's realm and exists. A path
  // that cannot be shown does not fail the run; the result says why, next to
  // the files it saved.
  private async showCard(
    session: RealmFsSession,
    scriptResult: string,
  ): Promise<{ shownCard?: string; showError?: string }> {
    let value: unknown;
    try {
      value = JSON.parse(scriptResult);
    } catch {
      return {};
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('show' in value)
    ) {
      return {};
    }
    let cardId: string;
    try {
      cardId = session.cardURL((value as { show: unknown }).show);
      let source = await this.cardService.getSource(rri(`${cardId}.json`));
      if (source.status !== 200) {
        // A path that names another file, such as an image or a module,
        // opens that file in code mode.
        let file = await this.cardService.getSource(rri(cardId));
        if (file.status !== 200) {
          throw new Error(`Not found: ${cardId}`);
        }
        await new ShowFileTool(this.toolContext).execute({
          fileIdentifier: cardId,
        });
        return { shownCard: cardId };
      }
      // The store's cached copy can predate a write this run just made, so
      // the card is read from the realm.
      let card = await this.store.getWithoutCache(cardId);
      if (!isCardInstance(card)) {
        throw new Error(`${cardId} is not a card instance: ${card.message}`);
      }
      await new ShowCardTool(this.toolContext).execute({ cardId });
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      return { showError: `The card was not shown. ${message}` };
    }
    return { shownCard: cardId };
  }

  // A module as a URL, for a prefix-form module such as
  // `@cardstack/base/card-api.gts`.
  private moduleURL(module: string): string {
    let { virtualNetwork } = this.network;
    return virtualNetwork.isRegisteredPrefix(module)
      ? virtualNetwork.toURL(module).href
      : module;
  }

  // An action that fails does not fail the run: its files are saved already.
  // The result names the failure, and later actions still run.
  private async applyUiAction(
    action: UiAction,
    realmURL: string,
  ): Promise<{
    action: string;
    target?: string;
    status: string;
    detail?: string;
  }> {
    let target: string | undefined;
    try {
      switch (action.action) {
        case 'switchSubmode':
          target = action.submode;
          await new SwitchSubmodeTool(this.toolContext).execute({
            submode: action.submode,
          });
          break;
        case 'openFile':
          target = action.url;
          await new SwitchSubmodeTool(this.toolContext).execute({
            submode: 'code',
            codePath: action.url,
          });
          break;
        case 'previewFormat':
          target = `${action.cardId} (${action.format})`;
          await new PreviewFormatTool(this.toolContext).execute({
            cardId: action.cardId,
            format: action.format,
            modulePath: this.moduleURL(action.modulePath),
          });
          break;
        case 'openWorkspace':
          target = realmURL;
          await new OpenWorkspaceTool(this.toolContext).execute({
            realmIdentifier: realmURL,
          });
          break;
      }
      return { action: action.action, target, status: 'done' };
    } catch (error) {
      let detail = error instanceof Error ? error.message : String(error);
      log.debug(`realm.ui.${action.action} failed: ${detail}`);
      return { action: action.action, target, status: 'failed', detail };
    }
  }

  private async captureURL(
    url: string,
    options: ViewOptions,
    doneBy: number,
    signal: AbortSignal,
  ): Promise<ViewedImage> {
    let services = {
      loaderService: this.loaderService,
      matrixService: this.matrixService,
      network: this.network,
      realm: this.realm,
      realmServer: this.realmServer,
    };
    return await captureForAgent(
      await resolveViewTarget(url, services, { signal }),
      options,
      services,
      { deadline: captureDeadline(doneBy), signal },
    );
  }

  // Lints a .gts/.ts file (unless `lint` is false), checks the realm still
  // holds what the script last saw, and saves it. Returns the content that
  // was saved.
  private async writeFile(
    roomId: string,
    url: string,
    content: string,
    expected: string | undefined,
    options?: { lint?: boolean },
  ): Promise<string | undefined> {
    if (options?.lint !== false && /\.(gts|ts)$/.test(url)) {
      let lint = await new LintAndFixTool(this.toolContext).execute({
        realm: this.realm.realmOf(rri(url))!,
        fileContent: content,
        filename: new URL(url).pathname.split('/').pop() || 'input.gts',
      });
      if (lint.lintErrors?.length) {
        throw new Error(`Lint errors in ${url}: ${lint.lintErrors.join('; ')}`);
      }
      content = lint.output;
    }
    // what is left to write is what the file holds: nothing to save
    if (expected !== undefined && content === expected) {
      return undefined;
    }
    let current = await this.readSource(url);
    if (expected === undefined) {
      if (current.status !== 404) {
        throw new Error(`File appeared while the script ran: ${url}`);
      }
    } else if (
      current.status !== 200 ||
      current.binary ||
      current.content !== expected
    ) {
      throw new Error(`File changed while the script ran: ${url}`);
    }
    let clientRequestId = this.toolService.trackAiAssistantCardRequest({
      action: 'run-realm-code',
      roomId,
      fileUrl: url,
    });
    await this.cardService.saveSource(rri(url), content, 'bot-patch', {
      resetLoader: /\.(gts|ts)$/.test(url),
      clientRequestId,
    });
    return content;
  }

  // Checks the realm still holds each card as the run first read it, then
  // saves every card in one atomic request: all of them or none. Each card is
  // tracked under the request's one client request id, so the correctness
  // check waits for its index event like any other saved file.
  private async saveCards(
    roomId: string,
    realmURL: string,
    updates: { url: string; content: string; expected: string }[],
  ): Promise<void> {
    let changed = (
      await Promise.all(
        updates.map(async ({ url, expected }) => {
          let current = await this.readSource(url);
          return current.status !== 200 ||
            current.binary ||
            current.content !== expected
            ? url
            : undefined;
        }),
      )
    ).filter((url) => url !== undefined);
    if (changed.length > 0) {
      throw new Error(
        `Cards changed while the script ran: ${changed.join(', ')}; no card update was saved`,
      );
    }
    let clientRequestId: string | undefined;
    for (let { url } of updates) {
      clientRequestId = this.toolService.trackAiAssistantCardRequest({
        action: 'run-realm-code',
        roomId,
        fileUrl: url,
        clientRequestId,
      });
    }
    let response = await this.cardService.executeAtomicOperations(
      updates.map(({ url, content }) => ({
        op: 'update' as const,
        href: url,
        data: { type: 'source' as const, attributes: { content }, meta: {} },
      })),
      ri(realmURL),
      { clientRequestId },
    );
    if (!Array.isArray(response?.['atomic:results'])) {
      let detail = (response as { errors?: { detail?: string }[] })?.errors?.[0]
        ?.detail;
      throw new Error(
        `The card updates were not saved: ${detail ?? 'the realm refused the write'}`,
      );
    }
  }

  // Reads a file's source. A file is binary when its bytes are not UTF-8, so
  // a text file saves back as the same bytes whatever content type the realm
  // serves it as. A body larger than any file realm.fs reads is not
  // downloaded: its content type alone says whether it is binary, and a text
  // one is too large.
  private async readSource(url: string): ReturnType<ReadSource> {
    // Never from the browser's cache: a conflict check that reads the 404
    // it saw before the run's own save would refuse that file's next edit.
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
      cache: 'no-store',
    });
    let { status } = response;
    if (status !== 200) {
      await response.body?.cancel();
      return { status, content: '', binary: false };
    }
    if (Number(response.headers.get('content-length')) > MAX_READ_BYTES) {
      await response.body?.cancel();
      let contentType = response.headers.get('content-type');
      let binary = !!contentType && isBinaryContentType(contentType);
      return { status, content: '', binary, tooLarge: !binary };
    }
    let bytes = new Uint8Array(await response.arrayBuffer());
    try {
      return { status, content: UTF8.decode(bytes), binary: false };
    } catch {
      return { status, content: '', binary: true };
    }
  }

  // Checks the file still does not exist, and saves the bytes as they are.
  private async writeBinaryFile(
    roomId: string,
    url: string,
    bytes: Uint8Array,
  ): Promise<void> {
    let current = await this.readSource(url);
    if (current.status !== 404) {
      throw new Error(`File appeared while the script ran: ${url}`);
    }
    let clientRequestId = this.toolService.trackAiAssistantCardRequest({
      action: 'run-realm-code',
      roomId,
      fileUrl: url,
    });
    if (clientRequestId) {
      this.cardService.clientRequestIds.add(clientRequestId);
    }
    let response = await this.network.authedFetch(url, {
      method: 'POST',
      headers: {
        // The realm routes a binary upload by this content type.
        'Content-Type': 'application/octet-stream',
        ...(clientRequestId
          ? { 'X-Boxel-Client-Request-Id': clientRequestId }
          : {}),
      },
      body: new Blob([bytes as BlobPart]),
    });
    if (!response.ok) {
      let text = '';
      try {
        text = (await response.text()).slice(0, 500);
      } catch {
        // The status is enough to report.
      }
      let wafRule = response.headers.get('x-blocked-by-waf-rule');
      throw new Error(
        [
          `Unable to save ${url}: ${response.status} ${response.statusText}`,
          wafRule ? `WAF rule: ${wafRule}` : null,
          text || null,
        ]
          .filter(Boolean)
          .join(' | '),
      );
    }
  }

  // Runs operations a card's type declares, on cards in the run's realm, as
  // one `_operations` request.
  //
  // Each card is loaded first, all at once, because only its type says what an
  // entry is: whether a name is declared or is a behavior every card carries,
  // whether it is a query, which params it needs, and which base it runs. The
  // request is then built by the operations client, as invoke-card-operation
  // builds it, so the method (QUERY for reads, POST for writes), each entry's
  // data and the decoded answer are the client's and not a copy of them.
  private async runOperations(
    entries: OperationEntry[],
  ): Promise<OperationAnswer[]> {
    let operationsModule = await this.loaderService.loader.import<
      typeof OperationsModule
    >('@cardstack/base/operations');
    let cardIds = [...new Set(entries.map((entry) => entry.cardId))];
    let loaded = await Promise.all(
      cardIds.map((id) => this.store.getWithoutCache(id)),
    );
    let cards = new Map<string, CardDef>();
    for (let [index, card] of loaded.entries()) {
      let cardId = cardIds[index]!;
      if (!isCardInstance(card)) {
        let entry = entries.find((one) => one.cardId === cardId)!;
        throw new Error(
          `cannot run "${entry.operation}": ${cardId} did not load: ${card.message}`,
        );
      }
      cards.set(cardId, card);
    }
    let bases = entries.map((entry) => {
      let card = cards.get(entry.cardId)!;
      let base = assertInstanceOperation(
        operationsModule,
        card,
        entry.operation,
      );
      assertPayloadSuppliesParams(
        entry.operation,
        operationsModule.getDeclaredOperations(card)[entry.operation],
        entry.payload,
      );
      return base;
    });
    let bucketFor = operationsModule.operations as (
      target: unknown,
    ) => OperationsBucket;
    let results: unknown[];
    if (entries.length === 1) {
      let [entry] = entries;
      let member = bucketFor(cards.get(entry!.cardId)!)[entry!.operation] as (
        payload?: unknown,
      ) => Promise<unknown>;
      results = [await member(entry!.payload)];
    } else {
      let atomic = bucketFor(cards.get(entries[0]!.cardId)!)[BATCH_MEMBER] as (
        build: (builder: { on(card: CardDef): OperationsBucket }) => void,
      ) => Promise<unknown[]>;
      results = await atomic((builder) => {
        for (let entry of entries) {
          let member = builder.on(cards.get(entry.cardId)!)[
            entry.operation
          ] as (payload?: unknown) => unknown;
          member(entry.payload);
        }
      });
    }
    return results.map((result, index) =>
      operationAnswer(result, bases[index]!),
    );
  }

  private async readCard(id: string, realmURL: string): Promise<CardRead> {
    // The store's cached instance can lag a write this run just made, or hold
    // edits not saved yet, so the card is read from the realm.
    let card = await this.store.getWithoutCache(id);
    // A path that holds a file rather than a card instance reads as the
    // file's FileDef.
    if (isFileDefInstance(card)) {
      return { unread: 'not-a-card' };
    }
    if (!isCardInstance(card)) {
      if (card.awaitingIndex) {
        // The realm holds the card's file and has no index row for it, which
        // is the same answer for a file a queued pass is about to index and
        // for one no pass will index. The realm's index events are what tell
        // them apart: between a pass's start and its end, the row may still
        // come.
        return {
          unread: this.realm.info(realmURL).isIndexing
            ? 'indexing'
            : 'unindexed',
        };
      }
      if (card.status === 404) {
        return { unread: 'not-found' };
      }
      // The realm marks the error its index row records, whatever status the
      // row carries. Any other failure (permissions, the network, the realm
      // itself) says nothing about the card's source.
      return {
        unread: card.meta?.indexError ? 'error' : 'unreadable',
        message: card.message,
      };
    }
    let { default: Base64ImageField } = await this.loaderService.loader.import<{
      default: typeof Base64ImageFieldType;
    }>('@cardstack/base/base64-image');
    return {
      doc: await this.cardService.serializeCard(card, {
        omitFields: [Base64ImageField],
        useAbsoluteURL: true,
        includeComputeds: true,
      }),
    };
  }

  // Checks the realm still holds what the run saved, and deletes the file.
  private async deleteFile(
    url: string,
    expected: { content: string } | { sha256: string } | undefined,
  ): Promise<void> {
    let unchanged =
      expected === undefined
        ? true
        : 'sha256' in expected
          ? (await this.readBinaryDigest(url)) === expected.sha256
          : await this.readSource(url).then(
              (current) =>
                current.status === 200 &&
                !current.binary &&
                current.content === expected.content,
            );
    if (!unchanged) {
      throw new Error(`File changed while the script ran: ${url}`);
    }
    await this.cardService.deleteSource(rri(url));
  }

  // The SHA-256 of a binary file's bytes, or undefined for a file that does
  // not exist or is larger than any file realm.fs.writeBytes saves.
  private async readBinaryDigest(url: string): Promise<string | undefined> {
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (
      response.status !== 200 ||
      Number(response.headers.get('content-length')) > MAX_BINARY_FILE_SIZE
    ) {
      await response.body?.cancel();
      return undefined;
    }
    return await sha256(new Uint8Array(await response.arrayBuffer()));
  }

  // Asks the model for a fix to a script that failed before it did anything,
  // and checks the fix. A fix that fails a guard, or a model that fails to
  // answer, leaves the original error, with the reason added.
  private async autoFix(
    code: string,
    error: RealmScriptErrorInfo,
    signal: AbortSignal,
  ): Promise<
    { code: string; activity: string; diff: string } | { rejected: string }
  > {
    let where = error.line ? ` at line ${error.line}` : '';
    let proposed;
    try {
      proposed = await proposeFix(
        code,
        error,
        this.proxySend(),
        AbortSignal.any([signal, AbortSignal.timeout(AUTO_FIX_TIMEOUT_MS)]),
      );
    } catch (cause) {
      return {
        rejected: `The runner could not auto-fix the ${error.name}${where}: ${coerceErrorMessage(cause, 'unknown error')}.`,
      };
    }
    let { diff, problem } = checkFix(code, proposed.code);
    if (problem) {
      return {
        rejected: `The runner tried to auto-fix the ${error.name}${where} and rejected the fix: ${problem}.\n${diff}`,
      };
    }
    return {
      code: proposed.code,
      activity: `Fixed a ${error.name}${where}: ${proposed.summary} (auto-fix by ${proposed.model})`,
      diff,
    };
  }

  private proxySend(): ProxySend {
    return ({ url, requestBody, signal }) =>
      this.realmServer.requestForward({
        url,
        method: 'POST',
        requestBody,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal,
      });
  }

  // The research calls send through the same proxy as images. A search asks
  // the room's model; the resolver picks its own small model.
  private research(roomId: string): Research {
    let send = this.proxySend();
    return {
      search: async (request, signal) => {
        let model =
          this.matrixService.getRoomData(roomId)?.activeLLM ||
          DEFAULT_WEB_SEARCH_LLM;
        return {
          results: await webSearch(request, model, send, signal),
          model,
        };
      },
      read: (request, timeoutMs, signal) =>
        webRead(request, timeoutMs, send, signal),
      resolve: (request, signal) => resolveJSON(request, send, signal),
    };
  }

  private async generateImage({
    prompt,
    sourceImageUrl,
    llmModel,
    signal,
  }: Parameters<GenerateImage>[0]): Promise<GeneratedImage> {
    return await generateImage(
      {
        prompt,
        sourceImageDataUrl: sourceImageUrl
          ? await sourceImageDataUrl(sourceImageUrl, (url) =>
              this.network.authedFetch(url, { signal }),
            )
          : undefined,
        model: llmModel,
      },
      ({ url, requestBody }) =>
        this.realmServer.requestForward({
          url,
          method: 'POST',
          requestBody,
          signal,
        }),
    );
  }

  // `authedFetch` adds the user's realm token when the URL is in a realm the
  // user can read, the same as the download-file-to-realm tool, so a capture
  // URL of a private realm downloads. Any other URL is a plain fetch.
  private async downloadFile(
    sourceUrl: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    let response = await this.network.authedFetch(sourceUrl, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Unable to download ${sourceUrl}: ${response.status} ${response.statusText}`,
      );
    }
    let declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadTooLarge();
    }
    if (!response.body) {
      let bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new DownloadTooLarge();
      }
      return bytes;
    }
    // Read in chunks, so a body without a declared length stops at the
    // limit instead of after it has all arrived.
    let reader = response.body.getReader();
    let chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadTooLarge();
      }
      chunks.push(value);
    }
    let bytes = new Uint8Array(total);
    let offset = 0;
    for (let chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private async listDirectory(
    url: string,
  ): Promise<{ status: number; entries: DirectoryEntry[] }> {
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.DirectoryListing },
    });
    if (!response.ok) {
      return { status: response.status, entries: [] };
    }
    let { data } = (await response.json()) as {
      data: {
        relationships?: Record<string, { meta?: { kind?: string } }>;
      };
    };
    // Directory names carry a trailing slash in the listing.
    return {
      status: 200,
      entries: Object.entries(data.relationships ?? {}).map(([name, info]) => ({
        name: name.replace(/\/$/, ''),
        kind: info.meta?.kind === 'directory' ? 'directory' : 'file',
      })),
    };
  }

  // realmOf matches an identifier only in the form the realm is keyed by, and
  // the input may name the realm by its prefix or by its URL, so a miss is
  // retried with the identifier resolved to its URL.
  private realmOfInput(
    realmId: RealmResourceIdentifier,
  ): RealmIdentifier | undefined {
    let realm = this.realm.realmOf(realmId);
    if (realm) {
      return realm;
    }
    try {
      return this.realm.realmOf(this.network.virtualNetwork.toURL(realmId));
    } catch {
      // resolves nowhere, so it names no known realm
      return undefined;
    }
  }

  // The sandbox resolves relative paths against the realm root, and file URLs
  // are URL-form, so the root must be too — a realm may be registered under
  // its prefix form.
  private realmRootURL(realm: string): string {
    let { virtualNetwork } = this.network;
    return virtualNetwork.isRegisteredPrefix(realm)
      ? virtualNetwork.toURL(realm).href
      : new URL(realm).href;
  }

  // A realm gated behind a skill feature (SKILL_FEATURE_REALMS) is searched
  // only in a room that enabled the feature; elsewhere it is left out of every
  // entry and card search, whether the script named it, ran in it, or relied
  // on the default of every readable realm. Answers whether a realm is gated
  // in the room.
  private featureGate(roomId: string): (realm: string) => boolean {
    // Only delivered events: one still sending, or that failed to send, has
    // not reached the bot that built the prompt.
    let events = (
      this.matrixService.roomResources.get(roomId)?.events ?? []
    ).filter((event) => event.status == null);
    // The bot's id is derived from the signed-in user's server; with no one
    // signed in no sender is excluded, and the bot never sends a feature command.
    let aiBotUserId = this.matrixService.userId
      ? this.matrixService.aiBotUserId
      : '';
    let { virtualNetwork } = this.network;
    // Named by prefix, which every build registers: a test build clears the
    // catalog's URL but keeps the prefix.
    let gated = realmsOfDisabledFeatures(
      sessionSkillFeatures(events, aiBotUserId),
    ).map(
      (realm) =>
        new RealmPaths(canonicalRealmIdentifier(virtualNetwork, realm)),
    );
    // A path beneath a gated realm, such as one of its folders, is gated too.
    return (realm) => {
      if (gated.length === 0) {
        return false;
      }
      let id = rri(canonicalRealmIdentifier(virtualNetwork, realm));
      return gated.some((paths) => paths.inRealm(id));
    };
  }

  // A scoped identifier the host has no mapping for would reach the realm
  // server as-is and come back as "Realms not found". Refusing it here lets
  // the message name the identifiers that do resolve.
  private assertKnownRealmIdentifiers(realms: string[] | undefined): void {
    let { virtualNetwork } = this.network;
    // Only a realm prefix itself names a realm: a package namespace such as
    // `@cardstack/boxel-ui/`, or a path beneath a realm prefix, does not.
    let unknown = (realms ?? []).find(
      (realm) =>
        isPrefixForm(realm) &&
        virtualNetwork.prefixKind(ensureTrailingSlash(realm)) !== 'realm',
    );
    if (unknown !== undefined) {
      throw new Error(
        `Unknown realm identifier "${unknown}". Pass a realm URL, or one of: ${virtualNetwork.knownRealms().join(', ')}`,
      );
    }
  }
}

export { RunRealmCodeTool as RunRealmCodeCommand };
