import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';

import ApplySearchReplaceBlockCommand from '../commands/apply-search-replace-block';
import { BoxelMeta } from '../components/ai-assistant/formatted-message';

interface CodeDiffResourceArgs {
  named: {
    searchReplaceBlock?: string | null;
    boxelMeta: BoxelMeta;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  @tracked boxelMeta: BoxelMeta | undefined | null;
  @tracked originalCode: string | undefined | null;
  @tracked modifiedCode: string | undefined | null;
  @tracked searchReplaceBlock: string | undefined | null;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { boxelMeta, searchReplaceBlock } = named;
    this.boxelMeta = boxelMeta;
    this.searchReplaceBlock = searchReplaceBlock;
    this.load.perform();
  }

  get isDataLoaded() {
    return this.originalCode != null && this.modifiedCode != null;
  }

  private load = restartableTask(async () => {
    let { boxelMeta, searchReplaceBlock } = this;
    if (!boxelMeta || !searchReplaceBlock) {
      return;
    }

    if (boxelMeta.isNewFile) {
      this.originalCode = '';
    } else {
      if (!boxelMeta.fileUrl) {
        throw new Error('boxelMeta.fileUrl is required');
      }
      this.originalCode = (
        await this.cardService.getSource(new URL(boxelMeta.fileUrl))
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
  boxelMeta?: BoxelMeta | null,
) {
  if (!boxelMeta || !searchReplaceBlock) {
    throw new Error('boxelMeta and searchReplaceBlock are required');
  }
  return CodeDiffResource.from(parent, () => ({
    named: {
      boxelMeta,
      searchReplaceBlock,
    },
  }));
}
