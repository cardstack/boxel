import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import runRealmCode from '../lib/realm-runner/runner';

import LintAndFixTool from './lint-and-fix';

import type { RealmRunnerCallMethod } from '../lib/realm-runner/types';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500_000;
// Host calls (source reads) run inside this budget too, so it is wider than a
// pure-CPU limit would need to be.
const RUN_TIMEOUT_MS = 30_000;

interface PreparedFile {
  url: string;
  content: string;
  existed: boolean;
  originalContent?: string;
}

// The host half of `realm.fs`: every call the script makes lands here, inside
// one realm. Reads come from the realm on first use and are kept as the
// baseline for the conflict check; writes change only the staged copy, which
// is saved after the script succeeds.
class RealmFsSession {
  // url -> content as the script now sees it; undefined means the file does
  // not exist.
  private staged = new Map<string, string | undefined>();
  private baseline = new Map<string, string | undefined>();
  readonly changed = new Set<string>();
  // Set by any failed call. A script that catches the rejection still fails
  // the run, so a half-applied batch is never saved.
  failure: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private realmURL: string,
    private readSource: (
      url: string,
    ) => Promise<{ status: number; content: string }>,
  ) {}

  // Calls run one at a time, so two unawaited calls cannot race over the same
  // staged file.
  call(method: RealmRunnerCallMethod, args: unknown[]): Promise<unknown> {
    let result = this.queue.then(() => this.dispatch(method, args));
    this.queue = result.catch(() => undefined);
    return result.catch((error: unknown) => {
      let message = error instanceof Error ? error.message : String(error);
      this.failure ??= message;
      throw error;
    });
  }

  prepared(): PreparedFile[] {
    return [...this.changed].map((url) => ({
      url,
      content: this.staged.get(url)!,
      existed: this.baseline.get(url) !== undefined,
      originalContent: this.baseline.get(url),
    }));
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
        this.stage(
          url,
          current.slice(0, first) +
            replacement +
            current.slice(first + search.length),
        );
        return { path: this.relative(url), matches: 1 };
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
        this.stage(url, content);
        return { path: this.relative(url), staged: true };
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
    if (this.staged.has(url)) {
      return this.staged.get(url);
    }
    if (this.staged.size >= MAX_FILES) {
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
    this.baseline.set(url, content);
    this.staged.set(url, content);
    return content;
  }

  private stage(url: string, content: string) {
    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File is too large after editing: ${url}`);
    }
    this.staged.set(url, content);
    this.changed.add(url);
  }
}

export default class RunRealmCodeTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmCodeInput,
  typeof BaseToolModule.RunRealmCodeResult
> {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private toolService: ToolService;

  description = 'Run safe Realm code that reads and edits realm source files.';
  static actionVerb = 'Run';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RunRealmCodeInput;
  }

  requireInputFields = ['code', 'realm', 'roomId'];

  protected async run(
    input: BaseToolModule.RunRealmCodeInput,
  ): Promise<BaseToolModule.RunRealmCodeResult> {
    if (!input.code || input.code.length > MAX_CODE_SIZE) {
      throw new Error(
        `Realm code must be between 1 and ${MAX_CODE_SIZE} characters`,
      );
    }
    let realmURL = this.realm.realmOf(rri(input.realm));
    if (!realmURL || !this.realm.canWrite(input.realm)) {
      throw new Error(`The current user cannot write ${input.realm}`);
    }

    let session = new RealmFsSession(this.realmRootURL(realmURL), (url) =>
      this.cardService.getSource(new URL(url)),
    );
    let runnerResult = await runRealmCode(
      {
        code: input.code,
        realmURL: this.realmRootURL(realmURL),
        timeoutMs: RUN_TIMEOUT_MS,
      },
      (method, args) => session.call(method, args),
    );
    if (session.failure) {
      throw new Error(
        `A realm call failed, so nothing was saved: ${session.failure}`,
      );
    }
    let prepared = await this.lintFiles(session.prepared());
    await this.assertNoConcurrentChanges(prepared);

    let commandModule = await this.loadToolModule();
    let outputFiles: BaseToolModule.RealmCodeFileResult[] = [];
    for (let file of prepared) {
      try {
        await this.assertNoConcurrentChanges([file]);
        let clientRequestId = this.toolService.trackAiAssistantCardRequest({
          action: 'run-realm-code',
          roomId: input.roomId,
          fileUrl: file.url,
        });
        await this.cardService.saveSource(
          new URL(file.url),
          file.content,
          'bot-patch',
          {
            resetLoader: /\.(gts|ts)$/.test(file.url),
            clientRequestId,
          },
        );
        outputFiles.push(
          new commandModule.RealmCodeFileResult({
            fileUrl: file.url,
            status: 'saved',
            detail:
              'Source saved; correctness validation will run after this tool result.',
          }),
        );
      } catch (error) {
        outputFiles.push(
          new commandModule.RealmCodeFileResult({
            fileUrl: file.url,
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    return new commandModule.RunRealmCodeResult({
      files: outputFiles,
      scriptResult: runnerResult.scriptResult,
    });
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

  private async lintFiles(files: PreparedFile[]): Promise<PreparedFile[]> {
    let prepared: PreparedFile[] = [];
    for (let file of files) {
      let content = file.content;
      if (/\.(gts|ts)$/.test(file.url)) {
        let lint = await new LintAndFixTool(this.toolContext).execute({
          realm: this.realm.realmOf(rri(file.url))!,
          fileContent: content,
          filename: new URL(file.url).pathname.split('/').pop() || 'input.gts',
        });
        if (lint.lintErrors?.length) {
          throw new Error(
            `Lint errors in ${file.url}: ${lint.lintErrors.join('; ')}`,
          );
        }
        content = lint.output;
      }
      prepared.push({ ...file, content });
    }
    return prepared;
  }

  private async assertNoConcurrentChanges(
    files: PreparedFile[],
  ): Promise<void> {
    for (let file of files) {
      let current = await this.cardService.getSource(new URL(file.url));
      if (file.existed) {
        if (
          current.status !== 200 ||
          current.content !== file.originalContent
        ) {
          throw new Error(`File changed while preparing edits: ${file.url}`);
        }
      } else if (current.status !== 404) {
        throw new Error(`File appeared while preparing edits: ${file.url}`);
      }
    }
  }
}

export { RunRealmCodeTool as RunRealmCodeCommand };
