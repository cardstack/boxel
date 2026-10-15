import { service } from '@ember/service';

import {
  assertQuery,
  coerceErrorMessage,
  isBinaryContentType,
  isCardInstance,
  isRelativePath,
  isResolvedCodeRef,
  logger,
  resourceIdentity,
  rri,
  searchEntryWireQueryFromQuery,
  SupportedMimeType,
  type CardResource,
  type EntryCollectionDocument,
  type Format,
  type LooseSingleCardDocument,
  type Query,
  type Relationship,
  type Saved,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_FALLBACK_MODELS,
} from '@cardstack/runtime-common/matrix-constants';

import HostBaseTool, { type ResultAttachment } from '../lib/host-base-tool';
import { RealmCaptures, type CaptureURL } from '../lib/realm-runner/captures';
import {
  RoomActions,
  type RequestedRoomChanges,
} from '../lib/realm-runner/room-actions';
import runRealmCode from '../lib/realm-runner/runner';
import { loadSkillSource } from '../lib/skill-tools';
import {
  captureDeadline,
  captureForAgent,
  resolveViewTarget,
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
  searchEntrySummaries,
  type EntrySummary,
  type SearchEntriesFn,
} from './search-entries';
import SetActiveLLMTool from './set-active-llm';
import ShowCardTool from './show-card';
import ShowFileTool from './show-file';
import SwitchSubmodeTool from './switch-submode';
import UpdateRoomSkillsTool from './update-room-skills';

import type { RealmRunnerCallMethod } from '../lib/realm-runner/types';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type Base64ImageFieldType from '@cardstack/base/base64-image';
import type * as BaseToolModule from '@cardstack/base/command';

const log = logger('tools:run-realm-code');

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
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
) => Promise<string>;

// Saves one binary file that did not exist.
type WriteBinaryFile = (url: string, bytes: Uint8Array) => Promise<void>;

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
// URL in it absolute.
type ReadCard = (id: string) => Promise<LooseSingleCardDocument>;

// Lists one directory. `entries` is empty unless `status` is 200.
type ListDirectory = (
  url: string,
) => Promise<{ status: number; entries: DirectoryEntry[] }>;

// Creates a workspace owned by the current user and returns its URL and name.
type CreateWorkspace = (input: {
  name?: string;
  endpoint?: string;
}) => Promise<{ url: string; name: string }>;

// Deletes a workspace the current user owns and returns its URL.
type DeleteWorkspace = (realmIdentifier: string) => Promise<{ url: string }>;

// A script that may delete a workspace names the call in its code. Such a
// run always waits for the user's click (`neverAutoExecutesFor`), the same as
// the delete-workspace tool, and only such a run may delete: a script that
// reaches the call another way is refused, so no delete runs without a click.
export function scriptDeletesWorkspaces(code: unknown): boolean {
  return typeof code === 'string' && code.includes('realm.workspaces.delete');
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
  'cards.search': false,
  'cards.get': false,
  'entries.search': false,
  capture: false,
  'workspaces.create': false,
  'workspaces.delete': false,
  'room.enableSkills': false,
  'room.disableSkills': false,
  'room.setModel': false,
  'ui.switchSubmode': false,
  'ui.openFile': false,
  'ui.previewFormat': false,
  'ui.openWorkspace': false,
};

// Runs one search in the run's realm and answers with the entry document.
type SearchCards = (
  query: SearchEntryWireQuery,
) => Promise<EntryCollectionDocument>;

// Resolves a reference — a URL, a realm's prefix-form identifier, or a path
// relative to `base` — to a URL.
type ResolveURL = (reference: string, base?: string) => string;

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
class RealmFsSession {
  // url -> content as the realm now holds it, as far as this run knows;
  // undefined means the file does not exist.
  private known = new Map<string, string | undefined>();
  // Files saved by this run, in the order of their first save.
  readonly saved = new Set<string>();
  // Workspaces created by this run, in order.
  readonly createdWorkspaces: string[] = [];
  // Workspaces deleted by this run, in order.
  readonly deletedWorkspaces: string[] = [];
  // Workspaces this run deleted that do not exist again: a later create at
  // the same URL takes the URL out.
  readonly goneWorkspaces = new Set<string>();
  // Binary files this run knows exist: found by a lookup or saved by
  // realm.fs.writeBytes. They are not in `known`, since their content is not
  // text, but they count toward MAX_FILES.
  readonly binary = new Set<string>();
  private binaryBytes = 0;
  // What `realm.capture` takes in this run.
  readonly captures: RealmCaptures;
  // What `realm.ui` asked for, in the order the script asked.
  readonly uiActions: UiAction[] = [];
  // Calls and saves refused because the run had already ended.
  private refused = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Aborted when the run ends, so a workspace create still in flight stops
  // holding up the report.
  private inFlight = new AbortController();
  // Set once the run has ended. A call that has not started yet is refused,
  // and a write still in flight is not saved, so nothing lands after the tool
  // has reported.
  private closed = false;

  constructor(
    private realmURL: string,
    private readSource: ReadSource,
    private writeFile: WriteFile,
    private writeBinaryFile: WriteBinaryFile,
    private listDirectory: ListDirectory,
    private search: SearchCards,
    private resolveURL: ResolveURL,
    private readCard: ReadCard,
    private searchEntries: SearchEntriesFn,
    captureURL: CaptureURL,
    private createWorkspace: CreateWorkspace,
    private deleteWorkspace: DeleteWorkspace,
    private mayDeleteWorkspaces: boolean,
    private mayWrite: boolean,
    readonly room: RoomActions,
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
    this.inFlight.abort();
  }

  // Settles once every call already made has finished or been refused.
  idle(): Promise<unknown> {
    return this.queue;
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
        // The lookup above recorded the file as missing.
        this.known.delete(url);
        this.binary.add(url);
        this.saved.add(url);
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
        let { data } = await this.readCard(id);
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
      case 'entries.search':
        return await this.searchEntriesFor(args[0], args[1]);
      case 'capture': {
        let url = this.resolve(method, args[0]);
        return await this.captures.take(url, this.relative(url), args[1]);
      }
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
        if (!this.mayDeleteWorkspaces) {
          throw new Error(
            'realm.workspaces.delete must be called by that name in the script, so the user confirms the run before it starts',
          );
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
        return this.room.setModel(args[0]);
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
      default:
        throw new Error(`Unknown realm call: ${String(method)}`);
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
      throw new TypeError('realms must be an array of realm URLs');
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
    let { rows, total, incomplete } = await searchEntrySummaries(
      this.searchEntries,
      query,
      { scope, limit: size, realms: realms as string[] | undefined },
    );
    let resultSize = 0;
    for (let [index, row] of rows.entries()) {
      resultSize += JSON.stringify(row).length;
      if (resultSize > MAX_ENTRY_RESULT_SIZE) {
        throw new Error(
          index > 0
            ? `These entries are too large to return; search again with limit ${index} or less`
            : `The entry ${row.url} is too large to return from a search`,
        );
      }
    }
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
    if (path === undefined || path === null || path === '') {
      return this.realmURL;
    }
    if (typeof path === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(path)) {
      let url = new URL(path).href;
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

  // Unlike `load`, this reads no content into the run, so it neither counts
  // toward MAX_FILES nor refuses a large file.
  private async exists(url: string): Promise<boolean> {
    if (this.known.has(url)) {
      return this.known.get(url) !== undefined;
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

  private relative(url: string): string {
    return url.slice(this.realmURL.length);
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

  private async load(url: string): Promise<string | undefined> {
    let content = await this.lookup(url);
    if (content === BINARY) {
      throw new Error(`${url} is a binary file; realm.fs reads only text`);
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
    this.known.set(url, saved);
    this.saved.add(url);
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

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

export default class RunRealmCodeTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmCodeInput,
  typeof BaseToolModule.RunRealmCodeResult
> {
  @service declare private cardService: CardService;
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
    'realm.cards.get, finds cards, specs and files across realms with ' +
    'realm.entries.search, can look at what it made with realm.capture, can ' +
    'create workspaces with realm.workspaces.create, and can change the ' +
    'skills and model of this room with room.*. In a workspace the user ' +
    'can only read, reads work and each write is refused. Return ' +
    '{ show: "<card path>" } to open a card in the realm when the run ends.';
  static actionVerb = 'Run';
  // `room.*` changes the room the call came from. The tool service sets
  // `roomId` to that room, so a model cannot point the changes at another
  // room it has joined.
  static bindsToInvokingRoom = true;

  static neverAutoExecutesFor(
    attributes: Record<string, unknown> | undefined,
  ): boolean {
    return scriptDeletesWorkspaces(attributes?.code);
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
    let realmURL = this.realm.realmOf(
      rri(realmInput.endsWith('/') ? realmInput : `${realmInput}/`),
    );
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

    let session = new RealmFsSession(
      this.realmRootURL(realmURL),
      (url) => this.readSource(url),
      (url, content, expected, options) =>
        this.writeFile(roomId, url, content, expected, options),
      (url, bytes) => this.writeBinaryFile(roomId, url, bytes),
      (url) => this.listDirectory(url),
      // The run reads only the rows' own data, so the linked cards' resources
      // are not asked for.
      (query) =>
        this.store.searchEntries(query, [realmURL], { linksOnly: true }),
      (reference, base) =>
        this.network.virtualNetwork.resolveURL(reference, base).href,
      (id) => this.readCard(id),
      (query, realms) => this.store.searchEntries(query, realms),
      (url, options, doneBy, signal) =>
        this.captureURL(url, options, doneBy, signal),
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
      scriptDeletesWorkspaces(input.code),
      this.realm.canWrite(realmURL),
      new RoomActions({
        checkSkill: (id) => this.checkSkill(id),
        knownModels: () => this.knownModels(roomId),
      }),
    );
    let runnerResult;
    let deadline = new AbortController();
    let deadlineTimer = setTimeout(
      () =>
        deadline.abort(
          new Error(
            `Realm code did not finish within ${CALL_DEADLINE_MS / 1000} s`,
          ),
        ),
      CALL_DEADLINE_MS,
    );
    // The worker allows the script `RUN_TIMEOUT_MS` once QuickJS is ready;
    // measured from here it is a conservative end, since sandbox start only
    // pushes the real one later.
    session.captures.runEndsAt = Date.now() + RUN_TIMEOUT_MS;
    try {
      runnerResult = await runRealmCode(
        {
          code: input.code,
          realmURL: this.realmRootURL(realmURL),
          timeoutMs: RUN_TIMEOUT_MS,
        },
        (method, args) => session.call(method, args),
        deadline.signal,
      );
    } catch (error) {
      clearTimeout(deadlineTimer);
      // Stop the session before reading what it saved: a call the script did
      // not await can still be running, and must neither save after this
      // report nor be missing from it.
      session.close();
      await session.idle();
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
      let report =
        saved.length > 0
          ? `${message}. Files already saved by this run: ${saved.join(', ')}`
          : `${message}. No file was saved.`;
      // Workspaces stay created too. Name them, so a retry does not create
      // them again. The run failed, so none of them is opened.
      if (session.createdWorkspaces.length > 0) {
        report += ` Workspaces already created by this run: ${session.createdWorkspaces.join(', ')}`;
      }
      // A delete cannot be undone, so the model must know it happened.
      if (session.deletedWorkspaces.length > 0) {
        report += ` Workspaces already deleted by this run: ${session.deletedWorkspaces.join(', ')}`;
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
      throw new Error(report);
    }

    clearTimeout(deadlineTimer);
    session.close();
    await session.idle();
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
      uiActions,
      ...shown,
      files: [...session.saved].map(
        (fileUrl) =>
          new commandModule.RealmCodeFileResult({
            fileUrl,
            status: 'saved',
            detail: session.binary.has(fileUrl)
              ? 'Binary file saved.'
              : 'Source saved; correctness validation will run after this tool result.',
          }),
      ),
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

  // The models the room's model picker offers: the configured ones, and any
  // model the room has used before.
  private knownModels(roomId: string): string[] {
    let configs = this.matrixService.systemCard?.modelConfigurations;
    let models = configs
      ? configs.flatMap((config) => (config.modelId ? [config.modelId] : []))
      : DEFAULT_FALLBACK_MODELS.map((model) => model.modelId);
    // The same models the room resource's `usedLLMs` lists, read from the
    // room's events, which exist whether or not the room is rendered.
    let usedLLMs = (this.matrixService.getRoomData(roomId)?.events ?? [])
      .filter((event) => event.type === APP_BOXEL_ACTIVE_LLM)
      .map((event) => (event.content as { model?: string }).model)
      .filter((model): model is string => !!model);
    return [...new Set([...models, ...usedLLMs])];
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
      let source = await this.cardService.getSource(new URL(`${cardId}.json`));
      if (source.status !== 200) {
        // A path that names another file, such as an image or a module,
        // opens that file in code mode.
        let file = await this.cardService.getSource(new URL(cardId));
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
  ): Promise<string> {
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
    await this.cardService.saveSource(new URL(url), content, 'bot-patch', {
      resetLoader: /\.(gts|ts)$/.test(url),
      clientRequestId,
    });
    return content;
  }

  // Reads a file's source. A file is binary when its bytes are not UTF-8, so
  // a text file saves back as the same bytes whatever content type the realm
  // serves it as. A body larger than any file realm.fs reads is not
  // downloaded: its content type alone says whether it is binary, and a text
  // one is too large.
  private async readSource(url: string): ReturnType<ReadSource> {
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
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

  private async readCard(id: string): Promise<LooseSingleCardDocument> {
    // The store's cached instance can lag a write this run just made, or hold
    // edits not saved yet, so the card is read from the realm.
    let card = await this.store.getWithoutCache(id);
    if (!isCardInstance(card)) {
      if (card.awaitingIndex) {
        throw new Error(
          `Card is not indexed yet: ${id}; read it again in a moment`,
        );
      }
      throw new Error(
        card.status === 404
          ? `Card not found: ${id}`
          : `Unable to read card ${id}: ${card.message}`,
      );
    }
    let { default: Base64ImageField } = await this.loaderService.loader.import<{
      default: typeof Base64ImageFieldType;
    }>('@cardstack/base/base64-image');
    return await this.cardService.serializeCard(card, {
      omitFields: [Base64ImageField],
      useAbsoluteURL: true,
      includeComputeds: true,
    });
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

  // The sandbox resolves relative paths against the realm root, and file URLs
  // are URL-form, so the root must be too — a realm may be registered under
  // its prefix form.
  private realmRootURL(realm: string): string {
    let { virtualNetwork } = this.network;
    return virtualNetwork.isRegisteredPrefix(realm)
      ? virtualNetwork.toURL(realm).href
      : new URL(realm).href;
  }
}

export { RunRealmCodeTool as RunRealmCodeCommand };
