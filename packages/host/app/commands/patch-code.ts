import { inject as service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { parseSearchReplace } from '../lib/search-replace-block-parsing';

import ApplySearchReplaceBlockCommand from './apply-search-replace-block';
import LintAndFixCommand from './lint-and-fix';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';

interface FileInfo {
  exists: boolean;
  hasContent: boolean;
  content: string;
}

export default class PatchCodeCommand extends HostBaseCommand<
  typeof BaseCommandModule.PatchCodeInput,
  typeof BaseCommandModule.PatchCodeCommandResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;

  description = `Apply code changes to file and then apply lint fixes`;
  static actionVerb = 'Apply';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PatchCodeInput } = commandModule;
    return PatchCodeInput;
  }

  protected async run(
    input: BaseCommandModule.PatchCodeInput,
  ): Promise<BaseCommandModule.PatchCodeCommandResult> {
    let { fileUrl, codeBlocks } = input;

    let fileInfo = await this.getFileInfo(fileUrl);
    let hasEmptySearchPortion = this.hasEmptySearchPortion(codeBlocks);
    let sourceContent = hasEmptySearchPortion ? '' : fileInfo.content;
    let { patchedCode, results } = await this.applyCodeBlocks(
      sourceContent,
      codeBlocks,
    );
    let finalFileUrl = fileUrl;
    if (results.some((r) => r.status === 'applied')) {
      let lintResult = await this.lintAndFix(fileUrl, patchedCode);
      patchedCode = lintResult.output;
      finalFileUrl = await this.determineFinalFileUrl(
        fileUrl,
        fileInfo,
        hasEmptySearchPortion,
      );

      await this.cardService.saveSource(
        new URL(finalFileUrl),
        patchedCode,
        'bot-patch',
      );
    }

    let commandModule = await this.loadCommandModule();
    const { PatchCodeCommandResult, PatchCodeResultField } = commandModule;

    return new PatchCodeCommandResult({
      patchedContent: patchedCode,
      finalFileUrl,
      results: results.map((result) => {
        return new PatchCodeResultField({
          status: result.status,
          failureReason: result.failureReason,
        });
      }),
    });
  }

  private async getFileInfo(fileUrl: string): Promise<FileInfo> {
    let getSourceResult = await this.cardService.getSource(new URL(fileUrl));
    let exists = getSourceResult.status !== 404;
    let content = exists ? getSourceResult.content : '';
    let hasContent = exists && content.trim() !== '';

    return { exists, hasContent, content };
  }

  private hasEmptySearchPortion(codeBlocks: string[]): boolean {
    if (codeBlocks.length !== 1) {
      return false;
    }

    let searchReplaceBlock = codeBlocks[0];
    let { searchContent } = parseSearchReplace(searchReplaceBlock);
    return searchContent.trim() === '';
  }

  private async applyCodeBlocks(
    initialContent: string,
    codeBlocks: string[],
  ): Promise<{
    patchedCode: string;
    results: { status: 'applied' | 'failed'; failureReason?: string }[];
  }> {
    let applyCommand = new ApplySearchReplaceBlockCommand(this.commandContext);
    let content = initialContent;
    let results: { status: 'applied' | 'failed'; failureReason?: string }[] =
      [];
    for (let codeBlock of codeBlocks) {
      try {
        let { resultContent } = await applyCommand.execute({
          fileContent: content,
          codeBlock: codeBlock,
        });
        content = resultContent;
        results.push({ status: 'applied' });
      } catch (error) {
        results.push({
          status: 'failed',
          failureReason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return { patchedCode: content, results };
  }

  private async lintAndFix(
    fileUrl: string,
    content: string,
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let lintCommand = new LintAndFixCommand(this.commandContext);
    let realmURL = this.realm.url(fileUrl);
    let filename = new URL(fileUrl).pathname.split('/').pop() || 'input.gts';

    return await lintCommand.execute({
      realm: realmURL,
      fileContent: content,
      filename: filename,
    });
  }

  private async determineFinalFileUrl(
    originalUrl: string,
    fileInfo: FileInfo,
    hasEmptySearchPortion: boolean,
  ): Promise<string> {
    if (!hasEmptySearchPortion || !fileInfo.exists || !fileInfo.hasContent) {
      return originalUrl;
    }

    return await this.findNonConflictingFilename(originalUrl);
  }

  private async findNonConflictingFilename(fileUrl: string): Promise<string> {
    let MAX_ATTEMPTS = 100;
    let { baseName, extension } = this.parseFilename(fileUrl);

    for (let counter = 1; counter < MAX_ATTEMPTS; counter++) {
      let candidateUrl = `${baseName}-${counter}${extension}`;
      let exists = await this.fileExists(candidateUrl);

      if (!exists) {
        return candidateUrl;
      }
    }

    return `${baseName}-${MAX_ATTEMPTS}${extension}`;
  }

  private parseFilename(fileUrl: string): {
    baseName: string;
    extension: string;
  } {
    let extensionMatch = fileUrl.match(/\.([^.]+)$/);
    let extension = extensionMatch?.[0] || '';
    let baseName = fileUrl.replace(/\.([^.]+)$/, '');

    return { baseName, extension };
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(new URL(fileUrl));
    return getSourceResult.status !== 404;
  }
}
