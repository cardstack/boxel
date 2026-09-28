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
// Host calls run inside this budget, and each write now lints and saves before
// it returns, so it is much wider than a pure-CPU limit would need to be. It
// stays under the tool service's own execute timeout.
const RUN_TIMEOUT_MS = 90_000;

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
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private realmURL: string,
    private readSource: (
      url: string,
    ) => Promise<{ status: number; content: string }>,
    private writeFile: WriteFile,
  ) {}

  // Calls run one at a time, so two unawaited calls cannot race over the same
  // file.
  call(method: RealmRunnerCallMethod, args: unknown[]): Promise<unknown> {
    let result = this.queue.then(() => this.dispatch(method, args));
    this.queue = result.catch(() => undefined);
    return result;
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

    let session = new RealmFsSession(
      this.realmRootURL(realmURL),
      (url) => this.cardService.getSource(new URL(url)),
      (url, content, expected) =>
        this.writeFile(input.roomId, url, content, expected),
    );
    let runnerResult;
    try {
      runnerResult = await runRealmCode(
        {
          code: input.code,
          realmURL: this.realmRootURL(realmURL),
          timeoutMs: RUN_TIMEOUT_MS,
        },
        (method, args) => session.call(method, args),
      );
    } catch (error) {
      // Writes are saved as they happen, so a failed run can have saved some
      // files already. Name them, so the model knows what state it left.
      let message = error instanceof Error ? error.message : String(error);
      let saved = [...session.saved];
      throw new Error(
        saved.length > 0
          ? `${message}. Files already saved by this run: ${saved.join(', ')}`
          : `${message}. No file was saved.`,
      );
    }

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
    });
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
