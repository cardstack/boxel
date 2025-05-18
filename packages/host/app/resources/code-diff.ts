import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';

import ApplySearchReplaceBlockCommand from '../commands/apply-search-replace-block';

interface CodeDiffResourceArgs {
  named: {
    fileUrl?: string | null;
    searchReplaceBlock?: string | null;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  @tracked fileUrl: string | undefined | null;
  @tracked originalCode: string | undefined | null;
  @tracked modifiedCode: string | undefined | null;
  @tracked searchReplaceBlock: string | undefined | null;
  @tracked errorMessage: string | undefined | null;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { fileUrl, searchReplaceBlock } = named;
    this.fileUrl = fileUrl;
    this.searchReplaceBlock = searchReplaceBlock;
    if (!fileUrl) {
      this.errorMessage = 'Missing file URL in the code block';
      return;
    }

    if (!searchReplaceBlock) {
      this.errorMessage = 'Missing search and replace block';
      return;
    }

    this.errorMessage = null;

    this.load.perform();
  }

  get isDataLoaded() {
    return this.originalCode != null && this.modifiedCode != null;
  }

  private load = restartableTask(async () => {
    let { fileUrl, searchReplaceBlock } = this;
    if (!fileUrl || !searchReplaceBlock) {
      return;
    }
    try {
      let result = (await this.cardService.getSource(new URL(fileUrl))).content;
      this.originalCode = result;
    } catch (error) {
      this.errorMessage = `Failed to load code from ${fileUrl}`;
      return;
    }

    let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
      this.commandService.commandContext,
    );

    let { resultContent: patchedCode } =
      await applySearchReplaceBlockCommand.execute({
        fileContent: this.originalCode,
        codeBlock: searchReplaceBlock,
      });
    this.modifiedCode = patchedCode;
  });
}

export function getCodeDiffResultResource(
  parent: object,
  fileUrl?: string | null,
  searchReplaceBlock?: string | null,
) {
  return CodeDiffResource.from(parent, () => ({
    named: {
      fileUrl,
      searchReplaceBlock,
    },
  }));
}
