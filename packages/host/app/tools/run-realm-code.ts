import { service } from '@ember/service';

import { logger, rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import runRealmCode from '../lib/realm-runner/runner';
import {
  captureDeadline,
  captureForAgent,
  resolveViewTarget,
  UPLOAD_RESERVE_MS,
  type ViewedImage,
  type ViewOptions,
} from '../lib/visual-capture';

import LintAndFixTool from './lint-and-fix';

import type { RealmRunnerCallMethod } from '../lib/realm-runner/types';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

const log = logger('tools:run-realm-code');

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500_000;
// Host calls run inside this budget, and each write lints and saves before it
// returns, so it is much wider than a pure-CPU limit would need to be.
const RUN_TIMEOUT_MS = 55_000;
// One deadline for the whole call: sandbox start, the script, and the write
// in flight when it ends. It is under the tool service's 120 s execute
// timeout, so this tool always reports first, with every file it saved, and
// nothing is saved after that report.
const CALL_DEADLINE_MS = 100_000;
// How many captures one run may attach with `realm.view`.
const MAX_VIEWS = 3;
// A view must finish this long before the run's own time limit, so the
// script still has time to use what it saw and return.
const VIEW_MARGIN_MS = 3_000;
// A view started with less time than this left before its own deadline is
// refused: the capture needs a few seconds after the upload reserve. An
// admitted view is bounded: its card probe has a short timeout of its own,
// its capture request is aborted at its deadline, and ending the run stops
// every step that waits.
const MIN_VIEW_BUDGET_MS = UPLOAD_RESERVE_MS + 5_000;

// Captures one realm URL and uploads the image, done by `doneBy`, or stopped
// when `signal` aborts.
type ViewURL = (
  url: string,
  options: ViewOptions,
  doneBy: number,
  signal: AbortSignal,
) => Promise<ViewedImage>;

// Saves one file and returns the content that was saved (lint may reformat
// it). `expected` is the content the script last saw, undefined for a file
// that did not exist; the save refuses if the realm no longer matches it.
type WriteFile = (
  url: string,
  content: string,
  expected: string | undefined,
) => Promise<string>;

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
  // Captures `realm.view` attached, in the order they were taken.
  readonly views: ViewedImage[] = [];
  // When the script's own time limit runs out; set as the run starts.
  runEndsAt = Number.POSITIVE_INFINITY;
  // Calls and saves refused because the run had already ended.
  refusedAfterClose = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Set once the run has ended. A call that has not started yet is refused,
  // and a write still in flight is not saved, so nothing lands after the tool
  // has reported.
  private closed = false;
  // Aborted when the run ends, so a view still capturing stops there rather
  // than uploading after the tool has reported.
  private viewsInFlight = new AbortController();

  constructor(
    private realmURL: string,
    private readSource: (
      url: string,
    ) => Promise<{ status: number; content: string }>,
    private writeFile: WriteFile,
    private viewURL: ViewURL,
  ) {}

  // Calls run one at a time, so two unawaited calls cannot race over the same
  // file.
  call(method: RealmRunnerCallMethod, args: unknown[]): Promise<unknown> {
    let result = this.queue.then(() => {
      if (this.closed) {
        this.refusedAfterClose += 1;
        throw new Error('The run has ended; this realm call was not made');
      }
      return this.dispatch(method, args);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  close() {
    this.closed = true;
    this.viewsInFlight.abort();
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
      case 'view': {
        let url = this.resolve(method, args[0]);
        if (this.views.length >= MAX_VIEWS) {
          throw new Error(
            `realm.view may capture at most ${MAX_VIEWS} times in one run; use the view-visually tool for more`,
          );
        }
        let doneBy = this.runEndsAt - VIEW_MARGIN_MS;
        if (doneBy - Date.now() < MIN_VIEW_BUDGET_MS) {
          throw new Error(
            `Not enough time left in this run to capture ${url}; use the view-visually tool instead`,
          );
        }
        let viewed = await this.viewURL(
          url,
          viewOptions(args[1]),
          doneBy,
          this.viewsInFlight.signal,
        );
        if (this.closed) {
          this.refusedAfterClose += 1;
          throw new Error(`The run has ended; the view of ${url} was dropped`);
        }
        this.views.push(viewed);
        // The image itself goes to the model with the tool result; the
        // script gets only what it needs to carry on.
        return {
          path: this.relative(url),
          kind: viewed.kind,
          format: viewed.format,
          width: viewed.width ?? null,
          height: viewed.height ?? null,
          ...(viewed.note ? { note: viewed.note } : {}),
          attached: true,
        };
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
      this.refusedAfterClose += 1;
      throw new Error(`The run has ended; ${url} was not saved`);
    }
    let saved = await this.writeFile(url, content, expected);
    this.known.set(url, saved);
    this.saved.add(url);
  }
}

// The options a script may pass to `realm.view`, taken field by field so
// nothing else reaches the capture.
function viewOptions(raw: unknown): ViewOptions {
  let options = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    ...(typeof options.format === 'string'
      ? { format: options.format as ViewOptions['format'] }
      : {}),
    ...(typeof options.viewportWidth === 'number'
      ? { viewportWidth: options.viewportWidth }
      : {}),
    ...(typeof options.viewportHeight === 'number'
      ? { viewportHeight: options.viewportHeight }
      : {}),
    ...(options.fullPage === true ? { fullPage: true } : {}),
  };
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
  @service declare private toolService: ToolService;

  description =
    'Run safe Realm code that reads and edits realm source files, and can ' +
    'look at what it made with realm.view.';
  static actionVerb = 'Run';

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
    if (!realmURL || !this.realm.canWrite(realmURL)) {
      throw new Error(`The current user cannot write ${realmInput}`);
    }

    let session = new RealmFsSession(
      this.realmRootURL(realmURL),
      (url) => this.cardService.getSource(new URL(url)),
      (url, content, expected) =>
        this.writeFile(roomId, url, content, expected),
      (url, options, doneBy, signal) =>
        this.viewURL(url, options, doneBy, signal),
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
    session.runEndsAt = Date.now() + RUN_TIMEOUT_MS;
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
      throw new Error(
        saved.length > 0
          ? `${message}. Files already saved by this run: ${saved.join(', ')}`
          : `${message}. No file was saved.`,
      );
    }

    clearTimeout(deadlineTimer);
    session.close();
    await session.idle();
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
      views: session.views.map(
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
    });
  }

  private async viewURL(
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
