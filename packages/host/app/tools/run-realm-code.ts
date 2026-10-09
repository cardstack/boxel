import { service } from '@ember/service';

import { logger, rri, SupportedMimeType } from '@cardstack/runtime-common';

import HostBaseTool, { type ResultAttachment } from '../lib/host-base-tool';
import { RealmCaptures, type CaptureURL } from '../lib/realm-runner/captures';
import runRealmCode from '../lib/realm-runner/runner';
import {
  captureDeadline,
  captureForAgent,
  resolveViewTarget,
  uploadedImages,
  type ViewedImage,
  type ViewOptions,
} from '../lib/visual-capture';
import { createWorkspace, deleteWorkspace } from '../lib/workspaces';

import LintAndFixTool from './lint-and-fix';

import type { RealmRunnerCallMethod } from '../lib/realm-runner/types';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

const log = logger('tools:run-realm-code');

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500_000;
// A script that loops by mistake must not fill the user's workspace list.
const MAX_WORKSPACES = 5;
// Host calls run inside this budget, and each write lints and saves before it
// returns, so it is much wider than a pure-CPU limit would need to be.
const RUN_TIMEOUT_MS = 55_000;
// One deadline for the whole call: sandbox start, the script, and the write
// in flight when it ends. It is under the tool service's 120 s execute
// timeout, so this tool always reports first, with every file it saved, and
// nothing is saved after that report.
const CALL_DEADLINE_MS = 100_000;
// Saves one file and returns the content that was saved (lint may reformat
// it). `expected` is the content the script last saw, undefined for a file
// that did not exist; the save refuses if the realm no longer matches it.
type WriteFile = (
  url: string,
  content: string,
  expected: string | undefined,
) => Promise<string>;

type DirectoryEntry = { name: string; kind: 'file' | 'directory' };

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
  capture: false,
  'workspaces.create': false,
  'workspaces.delete': false,
};

// The host half of `realm.fs`: every call the script makes lands here, inside
// one realm. Reads come from the realm on first use. A write saves the file
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
  // What `realm.capture` takes in this run.
  readonly captures: RealmCaptures;
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
    private readSource: (
      url: string,
    ) => Promise<{ status: number; content: string }>,
    private writeFile: WriteFile,
    private listDirectory: ListDirectory,
    captureURL: CaptureURL,
    private createWorkspace: CreateWorkspace,
    private deleteWorkspace: DeleteWorkspace,
    private mayDeleteWorkspaces: boolean,
    private mayWrite: boolean,
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
        return (await this.load(url)) !== undefined;
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
        if ((await this.load(url)) !== undefined) {
          throw new Error(
            `File already exists; use realm.fs.replace to edit it: ${url}`,
          );
        }
        await this.save(url, content, undefined);
        return { path: this.relative(url), saved: true };
      }
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

  private relative(url: string): string {
    return url.slice(this.realmURL.length);
  }

  private async load(url: string): Promise<string | undefined> {
    if (this.known.has(url)) {
      return this.known.get(url);
    }
    if (this.known.size >= MAX_FILES) {
      throw new Error(`Realm code may touch at most ${MAX_FILES} files`);
    }
    let source = await this.readSource(url);
    if (source.status !== 200 && source.status !== 404) {
      throw new Error(`Unable to read ${url}: ${source.status}`);
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
  ) {
    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File is too large after editing: ${url}`);
    }
    if (this.closed) {
      this.refused += 1;
      throw new Error(`The run has ended; ${url} was not saved`);
    }
    let saved = await this.writeFile(url, content, expected);
    this.known.set(url, saved);
    this.saved.add(url);
  }
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
  @service declare private toolService: ToolService;

  description =
    'Run safe Realm code that reads and edits realm source files, can ' +
    'look at what it made with realm.capture, and can create workspaces ' +
    'with realm.workspaces.create. In a workspace the user can only read, ' +
    'reads work and each write is refused.';
  static actionVerb = 'Run';

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
    // own, and in one the user can only write, the realm refuses each read.
    if (
      !realmURL ||
      !(this.realm.canRead(realmURL) || this.realm.canWrite(realmURL))
    ) {
      throw new Error(`The current user cannot read or write ${realmInput}`);
    }

    let session = new RealmFsSession(
      this.realmRootURL(realmURL),
      (url) => this.cardService.getSource(new URL(url)),
      (url, content, expected) =>
        this.writeFile(roomId, url, content, expected),
      (url) => this.listDirectory(url),
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
      throw new Error(report);
    }

    clearTimeout(deadlineTimer);
    session.close();
    await session.idle();
    await this.openCreatedWorkspace(session);
    let commandModule = await this.loadToolModule();
    return new commandModule.RunRealmCodeResult({
      files: [...session.saved].map(
        (fileUrl) =>
          new commandModule.RealmCodeFileResult({
            fileUrl,
            status: 'saved',
            detail:
              'Source saved; correctness validation will run after this tool result.',
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
    });
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

  // Lints a .gts/.ts file, checks the realm still holds what the script last
  // saw, and saves it. Returns the content that was saved.
  private async writeFile(
    roomId: string,
    url: string,
    content: string,
    expected: string | undefined,
  ): Promise<string> {
    if (/\.(gts|ts)$/.test(url)) {
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
    let current = await this.cardService.getSource(new URL(url));
    if (expected === undefined) {
      if (current.status !== 404) {
        throw new Error(`File appeared while the script ran: ${url}`);
      }
    } else if (current.status !== 200 || current.content !== expected) {
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
