import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';

import ApplySearchReplaceBlockCommand from '../commands/apply-search-replace-block';
import { CodeBlockMeta } from '../components/ai-assistant/formatted-message';

interface CodeDiffResourceArgs {
  named: {
    searchReplaceBlock?: string | null;
    codeBlockMeta: CodeBlockMeta;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  @tracked codeBlockMeta: CodeBlockMeta | undefined | null;
  @tracked originalCode: string | undefined | null;
  @tracked modifiedCode: string | undefined | null;
  @tracked searchReplaceBlock: string | undefined | null;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { codeBlockMeta, searchReplaceBlock } = named;
    this.codeBlockMeta = codeBlockMeta;
    this.searchReplaceBlock = searchReplaceBlock;
    this.load.perform();
  }

  get isDataLoaded() {
    return this.originalCode != null && this.modifiedCode != null;
  }

  private load = restartableTask(async () => {
    let { codeBlockMeta, searchReplaceBlock } = this;
    if (!codeBlockMeta || !searchReplaceBlock) {
      return;
    }

    if (codeBlockMeta.isNewFile) {
      this.originalCode = '';
    } else {
      if (!codeBlockMeta.fileUrl) {
        throw new Error('codeBlockMeta.fileUrl is required');
      }
      this.originalCode = (
        await this.cardService.getSource(new URL(codeBlockMeta.fileUrl))
      ).content;
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
  searchReplaceBlock?: string | null,
  codeBlockMeta?: CodeBlockMeta | null,
) {
  if (!codeBlockMeta || !searchReplaceBlock) {
    throw new Error('codeBlockMeta and searchReplaceBlock are required');
  }
  return CodeDiffResource.from(parent, () => ({
    named: {
      codeBlockMeta,
      searchReplaceBlock,
    },
  }));
}
