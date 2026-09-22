import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import runRealmCode from '../lib/realm-runner/runner';

import LintAndFixTool from './lint-and-fix';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500_000;
const RUN_TIMEOUT_MS = 10_000;

interface SourceFile {
  url: string;
  content: string;
}

interface PreparedFile extends SourceFile {
  existed: boolean;
  originalContent?: string;
}

export default class RunRealmCodeTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmCodeInput,
  typeof BaseToolModule.RunRealmCodeResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private toolService: ToolService;

  description =
    'Run safe Realm editing code against staged realm source files.';
  static actionVerb = 'Run';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RunRealmCodeInput;
  }

  requireInputFields = ['code', 'fileUrls', 'realm', 'roomId'];

  protected async run(
    input: BaseToolModule.RunRealmCodeInput,
  ): Promise<BaseToolModule.RunRealmCodeResult> {
    if (!input.code || input.code.length > MAX_CODE_SIZE) {
      throw new Error(
        `Realm code must be between 1 and ${MAX_CODE_SIZE} characters`,
      );
    }
    if (!Array.isArray(input.fileUrls) || input.fileUrls.length > MAX_FILES) {
      throw new Error(`Realm code may name at most ${MAX_FILES} files`);
    }

    let urls = [...new Set(input.fileUrls)].map((url) => new URL(url).href);
    if (urls.length === 0) {
      throw new Error('Realm code must name at least one file');
    }
    let files: SourceFile[] = [];
    let realmURL = this.realm.realmOf(rri(input.realm));
    if (!realmURL || !this.realm.canWrite(input.realm)) {
      throw new Error(`The current user cannot write ${input.realm}`);
    }
    for (let fileUrl of urls) {
      let url = new URL(fileUrl);
      let currentRealm = this.realm.realmOf(rri(url.href));
      if (!currentRealm || !this.realm.canWrite(url.href)) {
        throw new Error(`The current user cannot write ${url.href}`);
      }
      if (realmURL !== currentRealm)
        throw new Error('All files must be in one realm');
      let source = await this.cardService.getSource(url);
      if (source.status !== 200 && source.status !== 404)
        throw new Error(`Unable to read ${url.href}: ${source.status}`);
      if (source.status === 404) {
        continue;
      }
      if (source.content.length > MAX_FILE_SIZE)
        throw new Error(`File is too large: ${url.href}`);
      files.push({ url: url.href, content: source.content });
    }

    let runnerResult = await runRealmCode({
      code: input.code,
      files,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    let prepared = await this.prepareFiles(
      files,
      urls,
      runnerResult.operations,
    );
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

  private async prepareFiles(
    files: SourceFile[],
    urls: string[],
    operations: unknown,
  ): Promise<PreparedFile[]> {
    if (!Array.isArray(operations)) {
      throw new Error('Runner returned invalid operations');
    }
    let allowedURLs = new Set(urls);
    let original = new Map(files.map((file) => [file.url, file.content]));
    let staged = new Map(original);
    let changed = new Set<string>();

    for (let operation of operations) {
      if (!operation || typeof operation !== 'object') {
        throw new Error('Runner returned an invalid operation');
      }
      let { type, url, search, replacement, content } = operation as {
        type?: unknown;
        url?: unknown;
        search?: unknown;
        replacement?: unknown;
        content?: unknown;
      };
      if (typeof url !== 'string' || !allowedURLs.has(url)) {
        throw new Error(
          `Runner attempted to edit an undeclared file: ${String(url)}`,
        );
      }
      if (type === 'replace') {
        if (
          typeof search !== 'string' ||
          search.length === 0 ||
          typeof replacement !== 'string'
        ) {
          throw new Error(`Runner returned an invalid replacement for ${url}`);
        }
        let current = staged.get(url);
        if (current === undefined) {
          throw new Error(
            `Cannot replace content in a file that does not exist: ${url}`,
          );
        }
        let first = current.indexOf(search);
        if (
          first === -1 ||
          current.indexOf(search, first + search.length) !== -1
        ) {
          throw new Error(`Replacement must match exactly once in ${url}`);
        }
        staged.set(
          url,
          current.slice(0, first) +
            replacement +
            current.slice(first + search.length),
        );
      } else if (type === 'create') {
        if (typeof content !== 'string' || staged.has(url)) {
          throw new Error(
            `Runner returned an invalid file creation for ${url}`,
          );
        }
        staged.set(url, content);
      } else {
        throw new Error(`Runner returned an unsupported operation for ${url}`);
      }
      changed.add(url);
    }

    let prepared: PreparedFile[] = [];
    for (let url of changed) {
      let content = staged.get(url)!;
      if (content.length > MAX_FILE_SIZE) {
        throw new Error(`File is too large after editing: ${url}`);
      }
      if (/\.(gts|ts)$/.test(url)) {
        let lint = await new LintAndFixTool(this.toolContext).execute({
          realm: this.realm.realmOf(rri(url))!,
          fileContent: content,
          filename: new URL(url).pathname.split('/').pop() || 'input.gts',
        });
        if (lint.lintErrors?.length) {
          throw new Error(
            `Lint errors in ${url}: ${lint.lintErrors.join('; ')}`,
          );
        }
        content = lint.output;
      }
      prepared.push({
        url,
        content,
        existed: original.has(url),
        originalContent: original.get(url),
      });
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
