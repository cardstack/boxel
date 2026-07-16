import { service } from '@ember/service';

import { hasExecutableExtension, rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { parseSearchReplace } from '../lib/search-replace-block-parsing';
import { isReady } from '../resources/file';

import { findNonConflictingFilename } from '../utils/file-name';

import ApplySearchReplaceBlockTool from './apply-search-replace-block';
import LintAndFixTool from './lint-and-fix';

import type CardService from '../services/card-service';
import type MonacoService from '../services/monaco-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

interface FileInfo {
  exists: boolean;
  hasContent: boolean;
  content: string;
}

export default class PatchCodeTool extends HostBaseTool<
  typeof BaseToolModule.PatchCodeInput,
  typeof BaseToolModule.PatchCodeCommandResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private monacoService: MonacoService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private toolService: ToolService;

  description = `Apply code changes to file and then apply lint fixes`;
  static actionVerb = 'Apply';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PatchCodeInput } = commandModule;
    return PatchCodeInput;
  }

  requireInputFields = ['fileIdentifier', 'codeBlocks'];

  protected async run(
    input: BaseToolModule.PatchCodeInput,
  ): Promise<BaseToolModule.PatchCodeCommandResult> {
    let { fileIdentifier: fileUrl, codeBlocks, roomId } = input;

    let fileInfo = await this.getFileInfo(fileUrl);
    let hasEmptySearchPortion = this.hasEmptySearchPortion(codeBlocks);
    let sourceContent = hasEmptySearchPortion ? '' : fileInfo.content;
    let { patchedCode, results } = await this.applyCodeBlocks(
      sourceContent,
      codeBlocks,
    );
    let finalFileIdentifier = fileUrl;
    let lintIssues: string[] = [];
    if (results.some((r) => r.status === 'applied')) {
      if (patchedCode.trim() !== '' && this.isLintableFile(fileUrl)) {
        let lintResult = await this.lintAndFix(fileUrl, patchedCode);
        patchedCode = lintResult.output;
        lintIssues = lintResult.lintIssues ?? [];
      }

      finalFileIdentifier = await this.determineFinalFileUrl(
        fileUrl,
        fileInfo,
        hasEmptySearchPortion,
      );

      let clientRequestId = this.toolService.trackAiAssistantCardRequest({
        action: 'patch-code',
        roomId,
        fileUrl: finalFileIdentifier,
      });

      let savedThroughOpenFile = await this.trySaveThroughOpenFile(
        finalFileIdentifier,
        patchedCode,
        clientRequestId,
      );
      if (!savedThroughOpenFile) {
        this.cardService
          .saveSource(new URL(finalFileIdentifier), patchedCode, 'bot-patch', {
            resetLoader: hasExecutableExtension(finalFileIdentifier),
            clientRequestId,
          })
          .catch((error: unknown) => {
            console.error('PatchCodeTool: failed to save source', error);
          });
      }
    }

    let commandModule = await this.loadToolModule();
    const { PatchCodeCommandResult, PatchCodeResultField } = commandModule;

    return new PatchCodeCommandResult({
      patchedContent: patchedCode,
      finalFileIdentifier,
      lintIssues,
      results: results.map((result) => {
        return new PatchCodeResultField({
          status: result.status,
          failureReason: result.failureReason,
        });
      }),
    });
  }

  private async trySaveThroughOpenFile(
    targetFileUrl: string,
    content: string,
    clientRequestId?: string,
  ): Promise<boolean> {
    try {
      let openFileResource = this.operatorModeStateService.openFile?.current;
      if (!isReady(openFileResource)) {
        return false;
      }
      let normalizedOpenUrl = new URL(openFileResource.url).href;
      let normalizedTarget = new URL(targetFileUrl).href;
      if (normalizedOpenUrl !== normalizedTarget) {
        return false;
      }
      void openFileResource
        .write(content, {
          flushLoader: hasExecutableExtension(targetFileUrl),
          saveType: 'bot-patch',
          clientRequestId,
        })
        .catch((error: unknown) => {
          console.error(
            'PatchCodeTool: failed to write through FileResource',
            error,
          );
        });
      return true;
    } catch (error) {
      console.error(
        'PatchCodeTool: unable to save through FileResource',
        error,
      );
      return false;
    }
  }

  private async getFileInfo(fileUrl: string): Promise<FileInfo> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
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
    let applyCommand = new ApplySearchReplaceBlockTool(this.toolContext);
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
  ): Promise<BaseToolModule.LintAndFixResult> {
    let lintCommand = new LintAndFixTool(this.toolContext);
    let realmURL = this.realm.url(fileUrl);
    let filename = new URL(fileUrl).pathname.split('/').pop() || 'input.gts';

    return await lintCommand.execute({
      realm: realmURL,
      fileContent: content,
      filename: filename,
    });
  }

  private isLintableFile(fileUrl: string): boolean {
    try {
      return /\.(gts|ts)$/.test(new URL(fileUrl).pathname);
    } catch {
      return /\.(gts|ts)$/.test(fileUrl);
    }
  }

  private async determineFinalFileUrl(
    originalUrl: string,
    fileInfo: FileInfo,
    hasEmptySearchPortion: boolean,
  ): Promise<string> {
    if (!hasEmptySearchPortion || !fileInfo.exists || !fileInfo.hasContent) {
      return originalUrl;
    }

    return await findNonConflictingFilename(originalUrl, (candidateUrl) =>
      this.fileExists(candidateUrl),
    );
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
    return getSourceResult.status !== 404;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { PatchCodeTool as PatchCodeCommand };
