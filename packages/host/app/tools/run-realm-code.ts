import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import runRealmCode from '../lib/realm-runner/runner';

import LintAndFixTool from './lint-and-fix';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

const MAX_CODE_SIZE = 100_000;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500_000;
const RUN_TIMEOUT_MS = 10_000;

export default class RunRealmCodeTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmCodeInput,
  typeof BaseToolModule.RunRealmCodeResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;

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

    let urls = [...new Set(input.fileUrls)];
    let files = [] as { url: string; content: string }[];
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
      if (source.status !== 200)
        throw new Error(`Unable to read ${url.href}: ${source.status}`);
      if (source.content.length > MAX_FILE_SIZE)
        throw new Error(`File is too large: ${url.href}`);
      files.push({ url: url.href, content: source.content });
    }

    let runnerResult = await runRealmCode({
      code: input.code,
      files,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    let changed = new Set(
      runnerResult.operations.map((operation) => operation.url),
    );
    let outputFiles: BaseToolModule.RealmCodeFileResult[] = [];
    for (let url of changed) {
      let target = new URL(url);
      let targetRealm = this.realm.realmOf(rri(target.href));
      if (
        !targetRealm ||
        targetRealm !== realmURL ||
        !this.realm.canWrite(target.href)
      ) {
        throw new Error(`The current user cannot write ${url}`);
      }
      let current = runnerResult.files[url];
      if (typeof current !== 'string')
        throw new Error(`Runner returned no content for ${url}`);
      if (current.length > MAX_FILE_SIZE)
        throw new Error(`File is too large after editing: ${url}`);
      let original = files.find((file) => file.url === url)?.content;
      if (original !== undefined && original === current) continue;
      if (original === undefined) {
        let existing = await this.cardService.getSource(new URL(url));
        if (existing.status === 200)
          throw new Error(`File appeared while running: ${url}`);
      }
      if (/\.(gts|ts)$/.test(url)) {
        let lint = await new LintAndFixTool(this.toolContext).execute({
          realm: realmURL,
          fileContent: current,
          filename: new URL(url).pathname.split('/').pop() || 'input.gts',
        });
        current = lint.output;
        if (lint.lintErrors?.length) {
          throw new Error(
            `Lint errors in ${url}: ${lint.lintErrors.join('; ')}`,
          );
        }
      }
      await this.cardService.saveSource(new URL(url), current, 'bot-patch', {
        resetLoader: /\.(gts|ts)$/.test(url),
      });
      outputFiles.push(
        new (await this.loadToolModule()).RealmCodeFileResult({
          fileUrl: url,
          status: 'saved',
          detail:
            'Source saved; correctness validation will run after this tool result.',
        }),
      );
    }

    let commandModule = await this.loadToolModule();
    return new commandModule.RunRealmCodeResult({
      files: outputFiles,
      scriptResult: runnerResult.scriptResult,
    });
  }
}

export { RunRealmCodeTool as RunRealmCodeCommand };
