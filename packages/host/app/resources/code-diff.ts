import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import type CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';

import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import ApplySearchReplaceBlockCommand from '../commands/apply-search-replace-block';

interface CodeDiffResourceArgs {
  named: {
    fileUrl?: string | null;
    searchReplaceBlock?: string | null;
    codePatchStatus?: CodePatchStatus | null;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  @tracked fileUrl: string | undefined | null;
  @tracked originalCode: string | undefined | null;
  @tracked modifiedCode: string | undefined | null;
  @tracked searchReplaceBlock: string | undefined | null;
  @tracked errorMessage: string | undefined | null;
  codePatchStatus: CodePatchStatus | undefined | null;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { fileUrl, searchReplaceBlock, codePatchStatus } = named;
    this.errorMessage = null;
    this.fileUrl = fileUrl;
    this.searchReplaceBlock = searchReplaceBlock;
    this.codePatchStatus = codePatchStatus;
    if (!fileUrl) {
      this.errorMessage = 'Missing file URL in the code block';
      return;
    }

    if (!searchReplaceBlock) {
      this.errorMessage = 'Missing search and replace block';
      return;
    }

    this.load.perform();
  }

  get isDataLoaded() {
    return this.originalCode != null && this.modifiedCode != null;
  }

  private load = restartableTask(async () => {
    let { fileUrl, searchReplaceBlock, codePatchStatus } = this;
    if (codePatchStatus === 'applied') {
      // We currently don't show the diff for applied code patches.
      // Showing the diff for applied code patches won't work since in the
      // current code below we try to apply the patch against the original code,
      // but in this case the patch has already been applied.
      // We could make it work if we replaced the this.cardService.getSource below
      // with fetch of the matrix hosted attached file. But we deliberately
      // decided not to do that, and show the "// existing code ... " "// new code ... "
      // formatting instead. We decided to do that to avoid potential performance problems
      // when loading big chats with many code patches.
      return;
    }
    if (!fileUrl || !searchReplaceBlock) {
      return;
    }
    try {
      let result = await this.cardService.getSource(new URL(fileUrl));
      if (result.status === 404) {
        this.originalCode = ''; // We are creating a new file, so we don't have the original code
      } else {
        this.originalCode = result.content;
      }
    } catch (error) {
      this.errorMessage = `Failed to load code from ${fileUrl}`;
      return;
    }

    let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
      this.commandService.commandContext,
    );

    try {
      let { resultContent: patchedCode } =
        await applySearchReplaceBlockCommand.execute({
          fileContent: this.originalCode,
          codeBlock: searchReplaceBlock,
        });
      this.modifiedCode = patchedCode;
    } catch (error) {
      this.modifiedCode = this.originalCode;
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    }
  });
}

export function getCodeDiffResultResource(
  parent: object,
  fileUrl?: string | null,
  searchReplaceBlock?: string | null,
  codePatchStatus?: CodePatchStatus | null,
) {
  return CodeDiffResource.from(parent, () => ({
    named: {
      fileUrl,
      searchReplaceBlock,
      codePatchStatus,
    },
  }));
}
