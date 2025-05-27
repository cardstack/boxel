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
  typeof BaseCommandModule.LintAndFixResult
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
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let { fileUrl, codeBlocks } = input;

    let fileInfo = await this.getFileInfo(fileUrl);
    let hasEmptySearchPortion = this.hasEmptySearchPortion(codeBlocks);
    let sourceContent = hasEmptySearchPortion ? '' : fileInfo.content;
    let patchedCode = await this.applyCodeBlocks(sourceContent, codeBlocks);
    let lintResult = await this.lintAndFix(fileUrl, patchedCode);
    let finalFileUrl = await this.determineFinalFileUrl(
      fileUrl,
      fileInfo,
      hasEmptySearchPortion,
    );

    await this.cardService.saveSource(
      new URL(finalFileUrl),
      lintResult.output,
      'bot-patch',
    );

    return lintResult;
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
  ): Promise<string> {
    let applyCommand = new ApplySearchReplaceBlockCommand(this.commandContext);

    let content = initialContent;
    for (let codeBlock of codeBlocks) {
      let { resultContent } = await applyCommand.execute({
        fileContent: content,
        codeBlock: codeBlock,
      });
      content = resultContent;
    }

    return content;
  }

  private async lintAndFix(
    fileUrl: string,
    content: string,
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let lintCommand = new LintAndFixCommand(this.commandContext);
    let realmURL = this.realm.url(fileUrl);

    return await lintCommand.execute({
      realm: realmURL,
      fileContent: content,
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
